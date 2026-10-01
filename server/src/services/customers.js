/** Customer management: CRUD, search, full financial history per customer. */
import { getDb, transaction } from '../db/index.js';
import { nextCustomerCode } from '../lib/ids.js';
import { nowIso } from '../lib/dates.js';
import { notFound, validationError, badRequest } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import { audit } from './audit.js';

const MAX_RESULTS = 100;

export function searchCustomers({ q = '', limit = 25, offset = 0 } = {}) {
  const db = getDb();
  const term = `%${String(q).trim()}%`;
  const where = String(q).trim()
    ? `WHERE (full_name LIKE ? OR phone LIKE ? OR code LIKE ? OR IFNULL(address,'') LIKE ?)`
    : '';
  const params = where ? [term, term, term, term] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM customers ${where}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT id, code, full_name, phone, address, notes, is_demo, created_at
       FROM customers ${where} ORDER BY full_name LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(Number(limit) || 25, MAX_RESULTS), Number(offset) || 0);
  return { total, rows: rows.map(mapCustomer) };
}

function mapCustomer(r) {
  return { ...r, is_demo: !!r.is_demo };
}

export function getCustomer(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!row) throw notFound('Customer');
  return mapCustomer(row);
}

export function createCustomer({ full_name, phone = '', address = '', notes = '' }, user, ip) {
  const db = getDb();
  const name = String(full_name || '').trim();
  if (name.length < 2) throw validationError('Please enter the customer name');
  if (phone && !/^[+0-9()\-\s]{6,30}$/.test(phone)) throw validationError('Invalid phone number');

  const id = transaction((conn) => {
    const code = nextCustomerCode(conn);
    const r = conn
      .prepare(
        `INSERT INTO customers (code, full_name, phone, address, notes, created_by)
         VALUES (?,?,?,?,?,?)`
      )
      .run(code, name, String(phone).trim(), String(address).trim(), String(notes).trim(), user.id);
    const newId = Number(r.lastInsertRowid);
    audit(conn, {
      user,
      action: 'CREATE_CUSTOMER',
      entity: 'customer',
      entityId: code,
      newValue: { full_name: name, phone },
      ip,
    });
    return newId;
  });
  return getCustomer(id);
}

export function updateCustomer(id, patch, user, ip) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!before) throw notFound('Customer');
  const changes = {};
  const apply = (col, key, transform = (v) => v) => {
    if (patch[key] === undefined) return;
    const value = transform(patch[key]);
    if (value !== before[col]) {
      changes[key] = [before[col], value];
      db.prepare(`UPDATE customers SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value, nowIso(), id);
    }
  };
  apply('full_name', 'full_name', (v) => {
    const s = String(v || '').trim();
    if (s.length < 2) throw validationError('Please enter the customer name');
    return s;
  });
  apply('phone', 'phone', (v) => {
    const s = String(v || '').trim();
    if (s && !/^[+0-9()\-\s]{6,30}$/.test(s)) throw validationError('Invalid phone number');
    return s;
  });
  apply('address', 'address', (v) => String(v || '').trim());
  apply('notes', 'notes', (v) => String(v || '').trim());

  if (Object.keys(changes).length) {
    transaction((conn) =>
      audit(conn, {
        user,
        action: 'EDIT_CUSTOMER',
        entity: 'customer',
        entityId: before.code,
        oldValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])),
        newValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])),
        ip,
      })
    );
  }
  return getCustomer(id);
}

/**
 * Full customer profile: personal info + every money record.
 * Totals are grouped by currency (IQD and USD are never mixed).
 */
export function customerHistory(id) {
  const db = getDb();
  const customer = getCustomer(id);

  const transactions = db
    .prepare(
      `SELECT t.id, t.tx_number, t.biz_date, t.time, t.direction, t.amount_minor, t.currency,
              t.commission_minor, t.status, t.reference_no, t.description, t.payment_method,
              s.code AS service_code, s.name AS service_name,
              tt.code AS type_code, tt.name AS type_name
       FROM transactions t
       JOIN services s ON s.id = t.service_id
       JOIN transaction_types tt ON tt.id = t.type_id
       WHERE t.customer_id = ?
       ORDER BY t.biz_date DESC, t.id DESC
       LIMIT 500`
    )
    .all(id);

  const contracts = db
    .prepare(
      `SELECT c.id, c.contract_number, c.house_unit, c.total_required_minor, c.currency,
              c.due_date, c.notes,
              p.name AS project_name,
              IFNULL((SELECT SUM(rp.amount_minor) FROM ronaki_payments rp WHERE rp.contract_id = c.id), 0) AS paid_minor,
              (SELECT COUNT(*) FROM ronaki_payments rp WHERE rp.contract_id = c.id) AS payment_count
       FROM ronaki_contracts c
       JOIN ronaki_projects p ON p.id = c.project_id
       WHERE c.customer_id = ?
       ORDER BY c.id DESC`
    )
    .all(id)
    .map((c) => ({
      ...c,
      remaining_minor: c.total_required_minor - c.paid_minor,
      status: contractStatus(c),
    }));

  const ronakiPayments = db
    .prepare(
      `SELECT rp.id, rp.payment_number, rp.amount_minor, rp.currency, rp.biz_date, rp.created_at,
              c.contract_number, t.tx_number
       FROM ronaki_payments rp
       JOIN ronaki_contracts c ON c.id = rp.contract_id
       JOIN transactions t ON t.id = rp.txn_id
       WHERE c.customer_id = ?
       ORDER BY rp.biz_date DESC, rp.id DESC
       LIMIT 500`
    )
    .all(id);

  // Totals per currency — grouped, never mixed.
  const paidByCurrency = groupCurrency(
    db
      .prepare(
        `SELECT currency, SUM(amount_minor) AS total
         FROM transactions
         WHERE customer_id = ? AND direction = 'in' AND status = 'completed'
         GROUP BY currency`
      )
      .all(id)
  );

  const debtRows = db
    .prepare(
      `SELECT t.currency,
              SUM(CASE WHEN tt.code = 'credit_sale'     THEN t.amount_minor ELSE 0 END) AS credit_minor,
              SUM(CASE WHEN tt.code = 'customer_payment' THEN t.amount_minor ELSE 0 END) AS paid_minor
       FROM transactions t
       JOIN transaction_types tt ON tt.id = t.type_id
       WHERE t.customer_id = ? AND t.status = 'completed'
       GROUP BY t.currency`
    )
    .all(id);

  const outstanding = debtRows
    .map((r) => ({ currency: r.currency, outstanding_minor: r.credit_minor - r.paid_minor }))
    .filter((r) => r.outstanding_minor !== 0);

  const serviceTotals = db
    .prepare(
      `SELECT s.code, s.name, t.currency, COUNT(*) AS tx_count,
              SUM(CASE WHEN t.direction IN ('in','out','transfer') THEN t.amount_minor ELSE 0 END) AS volume_minor
       FROM transactions t JOIN services s ON s.id = t.service_id
       WHERE t.customer_id = ? AND t.status = 'completed'
       GROUP BY s.code, t.currency`
    )
    .all(id);

  const ronakiRemaining = contracts.reduce((acc, c) => {
    acc[c.currency] = (acc[c.currency] || 0) + c.remaining_minor;
    return acc;
  }, {});

  return {
    customer,
    transactions,
    contracts,
    ronakiPayments,
    totals: {
      total_paid_by_currency: paidByCurrency,
      outstanding_by_currency: outstanding,
      ronaki_remaining_by_currency: Object.entries(ronakiRemaining).map(([currency, remaining_minor]) => ({ currency, remaining_minor })),
      service_totals: serviceTotals,
      transaction_count: transactions.length,
    },
  };
}

export function contractStatus(c) {
  if (c.paid_minor >= c.total_required_minor) return 'paid';
  if (c.due_date && c.due_date < todayStr()) return 'overdue';
  if (c.paid_minor > 0) return 'partially_paid';
  return 'unpaid';
}

function todayStr() {
  return today();
}

export function groupCurrency(rows, totalKey = 'total') {
  return rows
    .filter((r) => r[totalKey] !== null)
    .map((r) => ({ currency: r.currency, [totalKey === 'total' ? 'amount_minor' : totalKey]: r[totalKey] }));
}

/** Count customers (for dashboard/setup checks). */
export function countCustomers() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM customers').get().c;
}

export function assertValidPhone(phone) {
  if (phone && !/^[+0-9()\-\s]{6,30}$/.test(phone)) throw badRequest('INVALID_PHONE', 'Invalid phone number');
  return phone;
}
