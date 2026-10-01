/** Expenses — detail records linked 1:1 to a money-moving transaction. */
import { getDb, transaction } from '../db/index.js';
import { nextExpenseNumber } from '../lib/ids.js';
import { today } from '../lib/dates.js';
import { toMinor } from '../lib/money.js';
import { notFound, validationError, conflict } from '../lib/errors.js';
import { audit } from './audit.js';
import { coreCreate, updateTransaction, getTransaction } from './transactions.js';
import { assertDayOpen } from './dayLock.js';

export function listExpenseCategories({ includeInactive = false } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, code, name, is_system, is_active FROM expense_categories
       ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, id`
    )
    .all();
  return rows.map((r) => ({ ...r, is_system: !!r.is_system, is_active: !!r.is_active }));
}

export function createExpenseCategory({ name, code }, user, ip) {
  const db = getDb();
  const finalCode = (code || name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  if (!name || String(name).trim().length < 2) throw validationError('Please enter the category name');
  const exists = db.prepare('SELECT id FROM expense_categories WHERE code = ?').get(finalCode);
  if (exists) throw conflict('CATEGORY_EXISTS', 'That category already exists');
  const id = transaction((conn) => {
    const r = conn
      .prepare('INSERT INTO expense_categories (code, name, is_system, sort_order) VALUES (?,?,0,100)')
      .run(finalCode, String(name).trim());
    audit(conn, { user, action: 'SETTINGS_CHANGED', entity: 'expense_category', entityId: finalCode, newValue: { name }, ip });
    return Number(r.lastInsertRowid);
  });
  return db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
}

export function recordExpense(input, user, ip) {
  const db = getDb();
  const {
    category_id, description, amount, currency = 'IQD', account_id,
    payment_method = 'cash', supplier = '', receipt_no = '', notes = '',
    biz_date = today(), force, force_reason,
  } = input;

  const category = db.prepare('SELECT * FROM expense_categories WHERE id = ? AND is_active = 1').get(category_id);
  if (!category) throw validationError('Please select an expense category');
  if (!description || String(description).trim().length < 2) throw validationError('Please enter the expense description');

  const amt = toMinor(amount);
  if (!amt || !Number.isSafeInteger(amt) || amt <= 0) throw validationError('Please enter the expense amount');

  const acct = account_id
    ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(account_id)
    : db.prepare(`SELECT * FROM accounts WHERE code = 'CASH'`).get();
  if (!acct) throw validationError('Invalid payment account');
  assertDayOpen(null, biz_date, currency, 'Recording an expense');

  return transaction((conn) => {
    // 1) the money movement (single ledger path)
    const txn = coreCreate(
      conn,
      {
        biz_date,
        time: input.time || undefined,
        service_id: db.prepare(`SELECT id FROM services WHERE code = 'other'`).get().id,
        type_id: db.prepare(`SELECT id FROM transaction_types WHERE code = 'expense'`).get().id,
        customer_id: null,
        account_id: acct.id,
        counter_account_id: null,
        direction: 'out',
        amount_minor: amt,
        currency,
        commission_minor: 0,
        payment_method,
        reference_no: receipt_no || null,
        description: `${category.name}: ${String(description).trim()}`,
        status: 'completed',
      },
      user
    );

    // 2) the expense detail record
    const expense_number = nextExpenseNumber(conn);
    const r = conn
      .prepare(
        `INSERT INTO expenses (expense_number, txn_id, category_id, description, supplier, receipt_no, notes)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(expense_number, txn.id, category_id, String(description).trim(), String(supplier).trim(), String(receipt_no).trim(), String(notes).trim());
    const expenseId = Number(r.lastInsertRowid);
    conn.prepare('UPDATE transactions SET expense_id = ? WHERE id = ?').run(expenseId, txn.id);

    audit(conn, {
      user, action: 'CREATE_EXPENSE', entity: 'expense', entityId: expense_number,
      newValue: { amount: `${amt / 100} ${currency}`, category: category.name, description },
      reason: force ? force_reason || 'Duplicate override' : null,
      ip,
    });
    if (force && force_reason) {
      audit(conn, {
        user, action: 'CREATE_EXPENSE', entity: 'expense', entityId: expense_number,
        reason: force_reason, newValue: { forced: true }, ip,
      });
    }
    return { expense: getExpense(expenseId), transaction: getTransaction(txn.id) };
  });
}

export function getExpense(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT e.*, c.name AS category_name, c.code AS category_code, t.tx_number, t.amount_minor, t.currency,
              t.biz_date, t.payment_method, t.status, u.full_name AS created_by_name
       FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id
       JOIN transactions t ON t.id = e.txn_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE e.id = ? OR e.expense_number = ?`
    )
    .get(Number(id) || 0, String(id));
  if (!row) throw notFound('Expense');
  return row;
}

export function listExpenses({ from, to, category_id, currency, q, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (from) { where.push('t.biz_date >= ?'); params.push(from); }
  if (to) { where.push('t.biz_date <= ?'); params.push(to); }
  if (category_id) { where.push('e.category_id = ?'); params.push(category_id); }
  if (currency) { where.push('t.currency = ?'); params.push(currency); }
  if (q) {
    where.push(`(e.description LIKE ? OR IFNULL(e.supplier,'') LIKE ? OR e.expense_number LIKE ? OR t.tx_number LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id
    JOIN transactions t ON t.id = e.txn_id
    LEFT JOIN users u ON u.id = t.created_by
    ${clause}`;

  const totals = db
    .prepare(`SELECT t.currency, COUNT(*) AS count, SUM(t.amount_minor) AS total_minor ${base} GROUP BY t.currency`)
    .all(...params);
  const total = db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT e.id, e.expense_number, e.description, e.supplier, e.receipt_no, e.notes,
              c.name AS category_name, c.id AS category_id,
              t.id AS txn_id, t.tx_number, t.amount_minor, t.currency, t.biz_date, t.payment_method,
              t.status, u.full_name AS created_by_name
       ${base} ORDER BY t.biz_date DESC, t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(limit, 300), offset);
  return { total, rows, totals };
}

export function updateExpense(id, patch, user, ip) {
  const db = getDb();
  const before = getExpense(id);
  const changes = {};
  const apply = (col, key, transform = (v) => v) => {
    if (patch[key] === undefined) return;
    const val = transform(patch[key]);
    if (String(val) !== String(before[col] ?? '')) {
      changes[key] = [before[col], val];
      db.prepare(`UPDATE expenses SET ${col} = ? WHERE id = ?`).run(val, id);
    }
  };
  if (patch.category_id !== undefined) {
    const cat = db.prepare('SELECT id FROM expense_categories WHERE id = ?').get(patch.category_id);
    if (!cat) throw validationError('Please select an expense category');
    changes.category_id = [before.category_id, patch.category_id];
    db.prepare('UPDATE expenses SET category_id = ? WHERE id = ?').run(patch.category_id, id);
  }
  apply('description', 'description', (v) => {
    const s = String(v || '').trim();
    if (s.length < 2) throw validationError('Please enter the expense description');
    return s;
  });
  apply('supplier', 'supplier', (v) => String(v || '').trim());
  apply('receipt_no', 'receipt_no', (v) => String(v || '').trim());
  apply('notes', 'notes', (v) => String(v || '').trim());

  // money fields go through the audited transaction editor
  if (patch.amount !== undefined || patch.biz_date !== undefined || patch.account_id !== undefined) {
    if (!patch.reason) throw validationError('A reason is required to change expense money fields');
    updateTransaction(
      before.txn_id,
      {
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.biz_date !== undefined ? { biz_date: patch.biz_date } : {}),
        ...(patch.account_id !== undefined ? { account_id: patch.account_id } : {}),
        reason: patch.reason,
      },
      user,
      ip
    );
    changes.amount_or_date = ['(see transaction audit)', 'updated'];
  }

  if (Object.keys(changes).length) {
    transaction((conn) =>
      audit(conn, {
        user, action: 'EDIT_EXPENSE', entity: 'expense', entityId: before.expense_number,
        oldValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])),
        newValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])),
        reason: patch.reason || null,
        ip,
      })
    );
  }
  return getExpense(id);
}
