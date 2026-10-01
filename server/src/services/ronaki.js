/**
 * Ronaki Project — contract & payment collection module.
 *
 * Integrity rules:
 *   - every payment creates a permanent ronaki_payments row AND a linked
 *     transactions row (single ledger posting path, no double counting)
 *   - Remaining = Total Required - SUM(payments), always computed, never typed
 *   - payments can never exceed the remaining balance (overpayment blocked)
 *   - contract status is derived: paid / overdue / partially_paid / unpaid
 */
import { getDb, transaction } from '../db/index.js';
import { nextRonakiPaymentNumber } from '../lib/ids.js';
import { today } from '../lib/dates.js';
import { toMinor } from '../lib/money.js';
import { notFound, validationError, badRequest, conflict } from '../lib/errors.js';
import { audit } from './audit.js';
import { coreCreate } from './transactions.js';
import { getReceipt } from './receipts.js';
import { contractStatus } from './customers.js';

export function listProjects() {
  return getDb().prepare('SELECT * FROM ronaki_projects ORDER BY id').all();
}

export function createProject({ code, name, location = '' }, user, ip) {
  const db = getDb();
  if (!code || !name) throw validationError('Project code and name are required');
  const exists = db.prepare('SELECT id FROM ronaki_projects WHERE code = ?').get(code);
  if (exists) throw conflict('PROJECT_EXISTS', 'A project with that code already exists');
  const id = transaction((conn) => {
    const r = conn.prepare('INSERT INTO ronaki_projects (code, name, location) VALUES (?,?,?)').run(code, name, location);
    audit(conn, { user, action: 'CREATE_RONAKI_PROJECT', entity: 'ronaki_project', entityId: code, newValue: { name }, ip });
    return Number(r.lastInsertRowid);
  });
  return db.prepare('SELECT * FROM ronaki_projects WHERE id = ?').get(id);
}

// ------------------------------------------------------------------
// Contracts
// ------------------------------------------------------------------

const CONTRACT_SELECT = `
  SELECT c.*, p.name AS project_name, p.code AS project_code,
         cu.full_name AS customer_name, cu.phone AS customer_phone, cu.code AS customer_code,
         IFNULL((SELECT SUM(rp.amount_minor) FROM ronaki_payments rp WHERE rp.contract_id = c.id), 0) AS paid_minor,
         (SELECT COUNT(*) FROM ronaki_payments rp WHERE rp.contract_id = c.id) AS payment_count,
         (SELECT MAX(rp.biz_date) FROM ronaki_payments rp WHERE rp.contract_id = c.id) AS last_payment_date
  FROM ronaki_contracts c
  JOIN ronaki_projects p ON p.id = c.project_id
  JOIN customers cu ON cu.id = c.customer_id`;

function decorate(c) {
  const remaining = c.total_required_minor - c.paid_minor;
  return {
    ...c,
    remaining_minor: remaining,
    status: contractStatus({ ...c, paid_minor: c.paid_minor }),
    is_demo: !!c.is_demo,
  };
}

export function listContracts({ q = '', project_id = null, status = null, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (q) {
    where.push(`(c.contract_number LIKE ? OR cu.full_name LIKE ? OR IFNULL(cu.phone,'') LIKE ?
                 OR IFNULL(c.house_unit,'') LIKE ? OR IFNULL(c.customer_ref,'') LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (project_id) { where.push('c.project_id = ?'); params.push(project_id); }

  let rows = db.prepare(`${CONTRACT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(limit, 200), offset)
    .map(decorate);

  if (status) rows = rows.filter((r) => r.status === status);

  const all = db.prepare(`${CONTRACT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...params).map(decorate);
  const summary = {
    total_customers: all.length,
    by_status: {
      paid: all.filter((r) => r.status === 'paid').length,
      partially_paid: all.filter((r) => r.status === 'partially_paid').length,
      unpaid: all.filter((r) => r.status === 'unpaid').length,
      overdue: all.filter((r) => r.status === 'overdue').length,
    },
    totals: aggregateByCurrency(all),
  };
  return { total: all.length, rows, summary };
}

function aggregateByCurrency(contracts) {
  const map = new Map();
  for (const c of contracts) {
    const cur = c.currency;
    if (!map.has(cur)) {
      map.set(cur, { currency: cur, total_required_minor: 0, paid_minor: 0, remaining_minor: 0 });
    }
    const agg = map.get(cur);
    agg.total_required_minor += c.total_required_minor;
    agg.paid_minor += c.paid_minor;
    agg.remaining_minor += c.total_required_minor - c.paid_minor;
  }
  return [...map.values()];
}

export function getContract(idOrNumber) {
  const db = getDb();
  const row = db
    .prepare(`${CONTRACT_SELECT} WHERE c.id = ? OR c.contract_number = ?`)
    .get(Number(idOrNumber) || 0, String(idOrNumber));
  if (!row) throw notFound('Ronaki contract');
  const payments = db
    .prepare(
      `SELECT rp.*, t.tx_number, u.full_name AS created_by_name
       FROM ronaki_payments rp
       JOIN transactions t ON t.id = rp.txn_id
       LEFT JOIN users u ON u.id = rp.created_by
       WHERE rp.contract_id = ? ORDER BY rp.biz_date DESC, rp.id DESC`
    )
    .all(row.id);
  return { ...decorate(row), payments };
}

export function createContract(input, user, ip) {
  const db = getDb();
  const {
    contract_number, project_id, customer_id, house_unit = '', customer_ref = '',
    total_required, currency = 'IQD', start_date, due_date = null, notes = '',
  } = input;

  if (!contract_number || !/^[A-Za-z0-9\-\/#. ]{2,40}$/.test(contract_number)) {
    throw validationError('Please enter a valid contract number');
  }
  const exists = db.prepare('SELECT id FROM ronaki_contracts WHERE contract_number = ?').get(contract_number);
  if (exists) throw conflict('CONTRACT_EXISTS', 'A contract with that number already exists');

  const project = db.prepare('SELECT id FROM ronaki_projects WHERE id = ?').get(project_id);
  if (!project) throw validationError('Please select a project');
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
  if (!customer) throw validationError('Please select a customer');

  // `total_required` is entered in display units (same convention as transactions)
  const total = input.total_required_minor != null ? Number(input.total_required_minor) : toMinor(total_required);
  if (!total || total <= 0) throw validationError('Please enter the total required amount');

  const id = transaction((conn) => {
    const r = conn
      .prepare(
        `INSERT INTO ronaki_contracts
          (contract_number, project_id, customer_id, house_unit, customer_ref, total_required_minor,
           currency, start_date, due_date, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        contract_number, project_id, customer_id, String(house_unit).trim(), String(customer_ref).trim(),
        total, currency, start_date || today(), due_date || null, String(notes).trim(), user.id
      );
    const newId = Number(r.lastInsertRowid);
    audit(conn, {
      user, action: 'CREATE_RONAKI_CONTRACT', entity: 'ronaki_contract', entityId: contract_number,
      newValue: { total: `${total / 100} ${currency}`, customer_id }, ip,
    });
    return newId;
  });
  return getContract(id);
}

export function updateContract(id, patch, user, ip) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM ronaki_contracts WHERE id = ?').get(id);
  if (!before) throw notFound('Ronaki contract');
  if (patch.currency && patch.currency !== before.currency) {
    throw badRequest('CURRENCY_LOCKED', 'Contract currency cannot change after creation');
  }
  const paidSoFar = db
    .prepare('SELECT IFNULL(SUM(amount_minor),0) AS paid FROM ronaki_payments WHERE contract_id = ?')
    .get(id).paid;
  const changes = {};
  const setIf = (col, key, transform = (v) => v) => {
    if (patch[key] === undefined) return;
    const val = transform(patch[key]);
    if (String(val) !== String(before[col] ?? '')) {
      changes[key] = [before[col], val];
      db.prepare(`UPDATE ronaki_contracts SET ${col} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(val, id);
    }
  };
  setIf('house_unit', 'house_unit', (v) => String(v || '').trim());
  setIf('customer_ref', 'customer_ref', (v) => String(v || '').trim());
  setIf('due_date', 'due_date', (v) => v || null);
  setIf('notes', 'notes', (v) => String(v || '').trim());
  setIf('total_required_minor', 'total_required', (v) => {
    const m = typeof v === 'string' ? toMinor(v) : Number(v);
    if (!m || m <= 0) throw validationError('Please enter the total required amount');
    if (m < paidSoFar) throw validationError('Total required cannot be lower than the amount already paid');
    return m;
  });

  if (Object.keys(changes).length) {
    transaction((conn) =>
      audit(conn, {
        user, action: 'EDIT_RONAKI_CONTRACT', entity: 'ronaki_contract', entityId: before.contract_number,
        oldValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])),
        newValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])),
        ip,
      })
    );
  }
  return getContract(id);
}

// ------------------------------------------------------------------
// Payments — the most critical write path
// ------------------------------------------------------------------

export function addPayment(input, user, ip) {
  const db = getDb();
  const contract = db.prepare('SELECT * FROM ronaki_contracts WHERE id = ?').get(Number(input.contract_id));
  if (!contract) throw notFound('Ronaki contract');

  // `amount` is entered in display units; amount_minor is accepted for internal callers
  let amount = input.amount_minor != null ? Number(input.amount_minor) : toMinor(input.amount);
  if (!amount || amount <= 0 || !Number.isSafeInteger(amount)) {
    throw validationError('Please enter the payment amount');
  }

  const currency = input.currency || contract.currency;
  if (currency !== contract.currency) {
    throw validationError(`This contract is in ${contract.currency}. Payments must use the same currency.`);
  }

  const paid = db
    .prepare('SELECT IFNULL(SUM(amount_minor),0) AS paid FROM ronaki_payments WHERE contract_id = ?')
    .get(contract.id).paid;
  const remaining = contract.total_required_minor - paid;
  if (amount > remaining) {
    throw badRequest(
      'OVERPAYMENT',
      `Payment exceeds the remaining balance. Remaining: ${(remaining / 100).toLocaleString('en-US')} ${contract.currency}`
    );
  }

  const accountId = input.account_id || db.prepare(`SELECT id FROM accounts WHERE code = 'CASH'`).get().id;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw validationError('Invalid account');

  return transaction((conn) => {
    // 1) the money record (single ledger posting path)
    const txn = coreCreate(
      conn,
      {
        biz_date: input.biz_date || today(),
        time: input.time || undefined,
        service_id: db.prepare(`SELECT id FROM services WHERE code = 'ronaki'`).get().id,
        type_id: db.prepare(`SELECT id FROM transaction_types WHERE code = 'payment_collection'`).get().id,
        customer_id: contract.customer_id,
        account_id: account.id,
        counter_account_id: null,
        direction: 'in',
        amount_minor: amount,
        currency,
        commission_minor: 0,
        payment_method: input.payment_method || 'cash',
        reference_no: input.reference_no || null,
        description: input.description || `Ronaki payment — contract ${contract.contract_number}`,
        status: 'completed',
        is_demo: input.is_demo || 0,
      },
      user
    );

    // 2) the contract allocation record
    const payment_number = nextRonakiPaymentNumber(conn);
    const r = conn
      .prepare(
        `INSERT INTO ronaki_payments (payment_number, contract_id, txn_id, amount_minor, currency, biz_date, notes, is_demo, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(payment_number, contract.id, txn.id, amount, currency, input.biz_date || today(), input.notes || null, input.is_demo || 0, user.id);
    const paymentId = Number(r.lastInsertRowid);

    conn.prepare('UPDATE transactions SET ronaki_payment_id = ? WHERE id = ?').run(paymentId, txn.id);

    audit(conn, {
      user, action: 'CREATE_PAYMENT', entity: 'ronaki_payment', entityId: payment_number,
      newValue: { amount: `${amount / 100} ${currency}`, contract: contract.contract_number }, ip,
    });

    const afterPaid = paid + amount;
    return {
      payment: conn.prepare('SELECT * FROM ronaki_payments WHERE id = ?').get(paymentId),
      transaction_id: txn.id,
      tx_number: txn.tx_number,
      contract: {
        id: contract.id,
        contract_number: contract.contract_number,
        total_required_minor: contract.total_required_minor,
        paid_minor: afterPaid,
        remaining_minor: contract.total_required_minor - afterPaid,
        status: contractStatus({
          ...contract,
          paid_minor: afterPaid,
        }),
      },
    };
  });
}

// ------------------------------------------------------------------
// Special Ronaki report
// ------------------------------------------------------------------

export function ronakiReport({ from = null, to = null, q = '', project_id = null, status = null } = {}) {
  const list = listContracts({ q, project_id, status, limit: 1000 });
  const contracts = list.rows;

  const where = ['c.id IS NOT NULL'];
  const params = [];
  if (q) {
    where.push(`(c.contract_number LIKE ? OR cu.full_name LIKE ? OR IFNULL(cu.phone,'') LIKE ? OR IFNULL(c.house_unit,'') LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (project_id) { where.push('c.project_id = ?'); params.push(project_id); }
  if (from) { where.push('rp.biz_date >= ?'); params.push(from); }
  if (to) { where.push('rp.biz_date <= ?'); params.push(to); }

  const payments = getDb()
    .prepare(
      `SELECT rp.payment_number, rp.amount_minor, rp.currency, rp.biz_date, rp.created_at,
              c.contract_number, cu.full_name AS customer_name, cu.phone AS customer_phone,
              c.house_unit, t.tx_number
       FROM ronaki_payments rp
       JOIN ronaki_contracts c ON c.id = rp.contract_id
       JOIN customers cu ON cu.id = c.customer_id
       JOIN transactions t ON t.id = rp.txn_id
       WHERE ${where.join(' AND ')}
       ORDER BY rp.biz_date DESC, rp.id DESC
       LIMIT 2000`
    )
    .all(...params);

  const collectedByCurrency = {};
  for (const p of payments) {
    collectedByCurrency[p.currency] = (collectedByCurrency[p.currency] || 0) + p.amount_minor;
  }

  return {
    summary: {
      total_customers: list.summary.total_customers,
      by_status: list.summary.by_status,
      totals: list.summary.totals,
      payments_in_range: payments.length,
      collected_in_range_by_currency: Object.entries(collectedByCurrency).map(([currency, amount_minor]) => ({ currency, amount_minor })),
    },
    contracts,
    payments,
  };
}
