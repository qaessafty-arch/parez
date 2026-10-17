/**
 * Transactions — the central financial module.
 *
 * Guarantees:
 *   - every money movement is one `transactions` row + derived `ledger_entries`
 *   - duplicate protection (reference no. OR same customer/amount/date/account/type)
 *   - completed transactions are never deleted: reverse / cancel / refund instead
 *   - every edit stores old -> new values in the audit log with a reason
 *   - IDs are unique (TX-YYYY-NNNNNN) and allocated inside the DB transaction
 *   - money is integer minor units; currencies are never mixed in totals
 */
import { all, one, run, transaction } from '../db/index.js';
import { nextTxNumber } from '../lib/ids.js';
import { today, nowTime, nowIso } from '../lib/dates.js';
import { netOf, sumMinor, toMinor } from '../lib/money.js';
import { notFound, validationError, conflict, badRequest, forbidden } from '../lib/errors.js';
import { audit } from './audit.js';
import { postLedger, unpostLedger, accountBalances } from './ledger.js';
import { getSetting } from './settings.js';
import { assertDayOpen } from './dayLock.js';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export async function getServiceById(id) {
  return one('SELECT * FROM services WHERE id = ?', id);
}
export async function getServiceByCode(code) {
  return one('SELECT * FROM services WHERE code = ?', code);
}
export async function getTypeById(id) {
  return one('SELECT * FROM transaction_types WHERE id = ?', id);
}
export async function getTypeByCode(code) {
  return one('SELECT * FROM transaction_types WHERE code = ?', code);
}

/**
 * Commission auto-calculation from settings rules (settings key: commission.rules).
 * Rules: [{ "service_code": "fastpay", "type_code": "*", "percent": 1 }]
 */
export async function commissionRules() {
  try {
    const raw = await getSetting('commission.rules');
    const rules = raw ? JSON.parse(raw) : [];
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

export async function autoCommission({ serviceCode, typeCode, amountMinor, currency }) {
  const rules = await commissionRules();
  for (const r of rules) {
    const svcOk = !r.service_code || r.service_code === '*' || r.service_code === serviceCode;
    const typeOk = !r.type_code || r.type_code === '*' || r.type_code === typeCode;
    const curOk = !r.currency || r.currency === '*' || r.currency === currency;
    if (svcOk && typeOk && curOk && r.percent != null) {
      const pct = Number(r.percent);
      if (Number.isFinite(pct) && pct > 0) {
        // integer math only: minor * percent / 100, rounded half-up
        return Math.round((amountMinor * pct) / 100);
      }
    }
  }
  return 0;
}

function resolveDirection(type, explicitDirection) {
  if (type.direction === 'none') {
    if (type.code === 'adjustment') {
      // Adjustments must state which way the correction moves money.
      if (!['in', 'out'].includes(explicitDirection || '')) {
        throw validationError('Please choose the transaction direction (in / out)');
      }
      return explicitDirection;
    }
    // debt-style records (credit_sale) stay 'none': no ledger movement
    return explicitDirection === 'in' || explicitDirection === 'out' ? explicitDirection : 'none';
  }
  return type.direction;
}

function computeNet(direction, amountMinor, commissionMinor) {
  if (direction === 'transfer') return amountMinor;
  return Math.max(0, netOf(amountMinor, commissionMinor));
}

// ------------------------------------------------------------------
// Duplicate protection
// ------------------------------------------------------------------

export async function findDuplicates(input) {
  const { reference_no, customer_id, amount_minor, currency, type_id, account_id, biz_date } = input;
  const rows = [];
  if (reference_no) {
    const byRef = await all(
      `SELECT t.id, t.tx_number, t.amount_minor, t.currency, t.biz_date, t.reference_no, t.status
       FROM transactions t WHERE t.reference_no = ? AND t.status IN ('completed','pending')`,
      reference_no
    );
    rows.push(...byRef);
  }
  if (customer_id && amount_minor > 0) {
    const similar = await all(
      `SELECT t.id, t.tx_number, t.amount_minor, t.currency, t.biz_date, t.reference_no, t.status
       FROM transactions t
       WHERE t.customer_id = ? AND t.amount_minor = ? AND t.currency = ? AND t.type_id = ?
         AND t.account_id = ? AND t.biz_date = ? AND t.status IN ('completed','pending')`,
      customer_id,
      amount_minor,
      currency,
      type_id,
      account_id,
      biz_date
    );
    rows.push(...similar);
  }
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// ------------------------------------------------------------------
// Create
// ------------------------------------------------------------------

const CREATE_FIELDS = [
  'tx_number',
  'biz_date', 'time', 'service_id', 'type_id', 'customer_id', 'account_id', 'counter_account_id',
  'direction', 'amount_minor', 'currency', 'commission_minor', 'net_minor', 'payment_method',
  'wallet_number', 'reference_no', 'description', 'fx_rate', 'fx_currency', 'fx_amount_minor',
  'status', 'reversal_of', 'related_to', 'is_demo', 'created_by', 'updated_by',
];

/** Core insert — must run inside a transaction(). Returns the saved row. */
export async function coreCreate(row, user) {
  const tx_number = await nextTxNumber();
  const full = {
    ...row,
    tx_number,
    biz_date: row.biz_date || today(),
    time: row.time || nowTime(),
    commission_minor: row.commission_minor || 0,
    status: row.status || 'completed',
    payment_method: row.payment_method || 'cash',
    is_demo: row.is_demo ? 1 : 0,
    created_by: user.id,
    updated_by: null,
  };
  full.net_minor = computeNet(full.direction, full.amount_minor, full.commission_minor);

  const cols = CREATE_FIELDS;
  const placeholders = cols.map(() => '?').join(',');
  const values = cols.map((c) => (full[c] === undefined ? null : full[c]));
  const r = await run(`INSERT INTO transactions (${cols.join(',')}) VALUES (${placeholders})`, ...values);
  const id = Number(r.lastInsertRowid);
  const saved = await one('SELECT * FROM transactions WHERE id = ?', id);
  await postLedger(saved);

  await audit({
    user,
    action: 'CREATE_TRANSACTION',
    entity: 'transaction',
    entityId: saved.tx_number,
    newValue: {
      amount: `${full.amount_minor / 100} ${full.currency}`,
      commission: `${full.commission_minor / 100} ${full.currency}`,
      direction: full.direction,
      type: full.type_id,
      account: full.account_id,
    },
  });
  return saved;
}

/**
 * Public create with validation + duplicate protection.
 * @param {object} input normalized create input (see route schema)
 */
export async function createTransaction(input, user, ip, { skipDuplicateCheck = false } = {}) {
  const service = input.service_id ? await getServiceById(input.service_id) : await getServiceByCode(input.service_code);
  if (!service) throw validationError('Please select a service');
  const type = input.type_id ? await getTypeById(input.type_id) : await getTypeByCode(input.type_code);
  if (!type) throw validationError('Please select a transaction type');

  const account = await one('SELECT * FROM accounts WHERE id = ?', input.account_id);
  if (!account) throw validationError('Please select an account/wallet');
  if (input.counter_account_id) {
    const counter = await one('SELECT * FROM accounts WHERE id = ?', input.counter_account_id);
    if (!counter) throw validationError('Invalid counter account');
    if (counter.id === account.id) throw validationError('Transfer accounts must be different');
  }

  const amount = typeof input.amount_minor === 'number' ? input.amount_minor : toMinor(input.amount);
  if (amount === null || amount <= 0) throw validationError('Please enter the transaction amount');

  const currency = input.currency || 'IQD';
  const cur = await one('SELECT code FROM currencies WHERE code = ? AND is_active = 1', currency);
  if (!cur) throw validationError('Unknown currency');

  let commission = input.commission_minor;
  if (commission === undefined || commission === null) {
    if (input.commission !== undefined && input.commission !== null) {
      // `commission` (no suffix) is entered in display units by the user
      const c = toMinor(input.commission);
      if (c === null) throw validationError('Invalid commission');
      commission = c;
    } else {
      commission = await autoCommission({
        serviceCode: service.code,
        typeCode: type.code,
        amountMinor: amount,
        currency,
      });
    }
  } else {
    commission = Number(commission);
  }
  if (commission < 0) throw validationError('Commission cannot be negative');
  if (commission > amount) throw validationError('Commission cannot exceed the transaction amount');

  if (input.customer_id) {
    const cust = await one('SELECT id FROM customers WHERE id = ?', input.customer_id);
    if (!cust) throw validationError('Unknown customer');
  }

  const direction = resolveDirection(type, input.direction);
  if (direction === 'transfer' && !input.counter_account_id) {
    throw validationError('A transfer needs a destination account');
  }

  const biz_date = input.biz_date || today();
  const row = {
    biz_date,
    time: input.time || nowTime(),
    service_id: service.id,
    type_id: type.id,
    customer_id: input.customer_id || null,
    account_id: account.id,
    counter_account_id: input.counter_account_id || null,
    direction,
    amount_minor: amount,
    currency,
    commission_minor: commission,
    payment_method: input.payment_method || 'cash',
    wallet_number: input.wallet_number || null,
    reference_no: input.reference_no || null,
    description: input.description || null,
    fx_rate: input.fx_rate || null,
    fx_currency: input.fx_currency || null,
    fx_amount_minor: input.fx_amount_minor ?? null,
    status: input.status || 'completed',
    reversal_of: input.reversal_of || null,
    related_to: input.related_to || null,
  };

  // Duplicate protection
  let duplicates = [];
  if (!skipDuplicateCheck && row.status !== 'cancelled') {
    duplicates = await findDuplicates(row);
    if (duplicates.length > 0 && !input.force) {
      throw conflict(
        'DUPLICATE_SUSPECTED',
        'A similar transaction already exists. Are you sure you want to continue?',
        { duplicates, hint: 'resubmit with force=true and force_reason' }
      );
    }
  }

  return transaction(async () => {
    await assertDayOpen(row.biz_date, row.currency, 'Creating a transaction');
    const saved = await coreCreate(row, user);
    if (duplicates.length > 0 && input.force) {
      await audit({
        user,
        action: 'CREATE_TRANSACTION',
        entity: 'transaction',
        entityId: saved.tx_number,
        reason: input.force_reason || 'Duplicate warning overridden',
        oldValue: { duplicates: duplicates.map((d) => d.tx_number) },
        newValue: { forced: true },
        ip,
      });
    }
    return saved;
  });
}

// ------------------------------------------------------------------
// Read
// ------------------------------------------------------------------

const LIST_MAX = 200;

export async function listTransactions(filters = {}) {
  const {
    from, to, service_code, service_id, type_code, customer_id, account_id, currency,
    status, q, direction, created_by, limit = 50, offset = 0, include_cancelled = true,
  } = filters;

  const where = [];
  const params = [];
  if (from) { where.push('t.biz_date >= ?'); params.push(from); }
  if (to) { where.push('t.biz_date <= ?'); params.push(to); }
  if (service_code) { where.push('s.code = ?'); params.push(service_code); }
  if (service_id) { where.push('t.service_id = ?'); params.push(service_id); }
  if (type_code) { where.push('tt.code = ?'); params.push(type_code); }
  if (customer_id) { where.push('t.customer_id = ?'); params.push(customer_id); }
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  if (currency) { where.push('t.currency = ?'); params.push(currency); }
  if (direction) { where.push('t.direction = ?'); params.push(direction); }
  if (created_by) { where.push('t.created_by = ?'); params.push(created_by); }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  } else if (!include_cancelled) {
    where.push(`t.status NOT IN ('cancelled')`);
  }
  if (q) {
    where.push(`(t.tx_number LIKE ? OR t.reference_no LIKE ? OR IFNULL(t.description,'') LIKE ?
                 OR IFNULL(c.full_name,'') LIKE ? OR IFNULL(c.phone,'') LIKE ? OR IFNULL(t.wallet_number,'') LIKE ?)`);
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like, like, like, like);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM transactions t
    JOIN services s ON s.id = t.service_id
    JOIN transaction_types tt ON tt.id = t.type_id
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.created_by
    ${clause}`;

  const total = (await one(`SELECT COUNT(*) AS c ${base}`, ...params)).c;

  const totals = await all(
    `SELECT t.currency,
            COUNT(*) AS tx_count,
            COALESCE(SUM(CASE WHEN t.direction = 'in'  THEN t.amount_minor ELSE 0 END), 0) AS inflow_minor,
            COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount_minor ELSE 0 END), 0) AS outflow_minor,
            COALESCE(SUM(t.commission_minor), 0) AS commission_minor
     ${base} GROUP BY t.currency`,
    ...params
  );

  const rows = await all(
    `SELECT t.*, s.code AS service_code, s.name AS service_name,
            tt.code AS type_code, tt.name AS type_name,
            c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
            a.code AS account_code, a.name AS account_name,
            u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM transactions r WHERE r.reversal_of = t.id) AS reversal_count
     ${base}
     ORDER BY t.biz_date DESC, t.time DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Number(limit) || 50, LIST_MAX),
    Number(offset) || 0
  );

  return { total, rows, totals: totals.filter((t) => t.tx_count > 0) };
}

export async function getTransaction(idOrNumber) {
  const row = await one(
    `SELECT t.*, s.code AS service_code, s.name AS service_name,
            tt.code AS type_code, tt.name AS type_name,
            c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
            a.code AS account_code, a.name AS account_name,
            ca.code AS counter_account_code, ca.name AS counter_account_name,
            u.full_name AS created_by_name, e.full_name AS updated_by_name
     FROM transactions t
     JOIN services s ON s.id = t.service_id
     JOIN transaction_types tt ON tt.id = t.type_id
     LEFT JOIN customers c ON c.id = t.customer_id
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ca ON ca.id = t.counter_account_id
     JOIN users u ON u.id = t.created_by
     LEFT JOIN users e ON e.id = t.updated_by
     WHERE t.id = ? OR t.tx_number = ?`,
    Number(idOrNumber) || 0,
    String(idOrNumber)
  );
  if (!row) throw notFound('Transaction');

  const ledger = await all(
    `SELECT l.*, a.code AS account_code, a.name AS account_name
     FROM ledger_entries l JOIN accounts a ON a.id = l.account_id
     WHERE l.txn_id = ?`,
    row.id
  );
  const receipts = await all('SELECT id, receipt_number, created_at, print_count FROM receipts WHERE txn_id = ? ORDER BY id', row.id);
  const related = await all(
    `SELECT id, tx_number, direction, amount_minor, currency, status, biz_date
     FROM transactions WHERE reversal_of = ? OR related_to = ? ORDER BY id`,
    row.id,
    row.id
  );
  const auditRows = await all(
    `SELECT * FROM audit_logs WHERE entity = 'transaction' AND entity_id = ? ORDER BY id DESC`,
    row.tx_number
  );

  return { ...row, ledger, receipts, related, audit: auditRows };
}

// ------------------------------------------------------------------
// Correct / edit (audit: old -> new, reason required for completed txns)
// ------------------------------------------------------------------

const EDITABLE = [
  'amount_minor', 'commission_minor', 'reference_no', 'description', 'wallet_number',
  'biz_date', 'time', 'payment_method', 'account_id', 'counter_account_id', 'customer_id', 'status',
];

export async function updateTransaction(id, patch, user, ip) {
  const before = await one('SELECT * FROM transactions WHERE id = ?', id);
  if (!before) throw notFound('Transaction');
  if (before.status === 'reversed') throw badRequest('ALREADY_REVERSED', 'A reversed transaction cannot be edited — create an adjustment instead');
  if (before.status === 'cancelled') throw badRequest('ALREADY_CANCELLED', 'A cancelled transaction cannot be edited');

  // `amount` / `commission` arrive in display units; *_minor fields are already minor units.
  patch = { ...patch };
  if (patch.amount !== undefined) {
    patch.amount_minor = toMinor(patch.amount);
    delete patch.amount;
    if (patch.amount_minor === null) throw validationError('Invalid amount');
  }
  if (patch.commission !== undefined) {
    patch.commission_minor = toMinor(patch.commission);
    delete patch.commission;
    if (patch.commission_minor === null) throw validationError('Invalid commission');
  }

  const changes = {};
  for (const field of EDITABLE) {
    if (patch[field] === undefined) continue;
    let value = patch[field];
    if (field === 'amount_minor' || field === 'commission_minor') {
      value = typeof value === 'number' ? value : toMinor(value);
      if (value === null || value < 0) throw validationError(`Invalid ${field}`);
    }
    if (String(value) === String(before[field] ?? '')) continue;
    changes[field] = value;
  }

  if (!Object.keys(changes).length) return getTransaction(id);

  const reason = patch.reason ? String(patch.reason).trim() : '';
  const touchesMoney = 'amount_minor' in changes || 'commission_minor' in changes || 'account_id' in changes;
  if ((touchesMoney || before.status === 'completed') && !reason) {
    throw validationError('A reason is required to modify a financial record');
  }

  return transaction(async () => {
    const merged = { ...before, ...changes };
    const amount = merged.amount_minor;
    const commission = Math.min(merged.commission_minor || 0, amount);
    if (commission > amount) throw validationError('Commission cannot exceed the transaction amount');
    const net = computeNet(merged.direction, amount, commission);
    await assertDayOpen(merged.biz_date, merged.currency, 'Modifying a transaction');

    const sets = ['net_minor = ?', 'commission_minor = ?', 'updated_by = ?', 'updated_at = ?'];
    const values = [net, commission, user.id, nowIso()];
    for (const field of Object.keys(changes)) {
      if (field === 'status' && changes.status === 'completed' && before.status === 'pending') {
        // pending -> completed allowed without extra audit fields
      }
      sets.push(`${field} = ?`);
      values.push(changes[field]);
    }
    values.push(id);
    await run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, ...values);

    // Re-post ledger derived from the new values
    await unpostLedger(id);
    const saved = await one('SELECT * FROM transactions WHERE id = ?', id);
    if (saved.status === 'completed') await postLedger(saved);

    await audit({
      user,
      action: 'EDIT_TRANSACTION',
      entity: 'transaction',
      entityId: before.tx_number,
      oldValue: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]])),
      newValue: Object.fromEntries(Object.keys(changes).map((k) => [k, changes[k]])),
      reason: reason || null,
      ip,
    });
    return saved;
  });
}

// ------------------------------------------------------------------
// Reverse / cancel / refund — no permanent deletions, ever
// ------------------------------------------------------------------

export async function reverseTransaction(id, { reason }, user, ip) {
  const original = await one('SELECT * FROM transactions WHERE id = ?', id);
  if (!original) throw notFound('Transaction');
  if (original.status === 'reversed') throw badRequest('ALREADY_REVERSED', 'This transaction has already been reversed');
  if (original.status === 'cancelled') throw badRequest('ALREADY_CANCELLED', 'A cancelled transaction cannot be reversed');
  if (!reason || !String(reason).trim()) throw validationError('A reason is required to reverse a transaction');

  return transaction(async () => {
    const reversalType = await getTypeByCode('reversal');
    const reversal = await coreCreate(
      {
        biz_date: today(),
        time: nowTime(),
        service_id: original.service_id,
        type_id: reversalType.id,
        customer_id: original.customer_id,
        account_id: original.account_id,
        counter_account_id: original.counter_account_id,
        direction: original.direction,
        amount_minor: original.amount_minor,
        currency: original.currency,
        commission_minor: 0,
        payment_method: original.payment_method,
        reference_no: original.reference_no,
        description: `Reversal of ${original.tx_number}`,
        status: 'completed',
        reversal_of: original.id,
      },
      user
    );
    await run(
      `UPDATE transactions SET status = 'reversed', reversed_by = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      reversal.id,
      user.id,
      nowIso(),
      original.id
    );
    await audit({
      user,
      action: 'REVERSE_TRANSACTION',
      entity: 'transaction',
      entityId: original.tx_number,
      oldValue: { status: original.status, amount: original.amount_minor, currency: original.currency },
      newValue: { status: 'reversed', reversal: reversal.tx_number },
      reason: String(reason).trim(),
      ip,
    });
    return { original: await getTransaction(original.id), reversal: await getTransaction(reversal.id) };
  });
}

export async function cancelTransaction(id, { reason }, user, ip) {
  const original = await one('SELECT * FROM transactions WHERE id = ?', id);
  if (!original) throw notFound('Transaction');
  if (original.status !== 'pending') {
    throw badRequest('CANCEL_ONLY_PENDING', 'Only pending transactions can be cancelled. Completed transactions must be reversed.');
  }
  if (!reason || !String(reason).trim()) throw validationError('A reason is required to cancel a transaction');

  return transaction(async () => {
    await assertDayOpen(original.biz_date, original.currency, 'Cancelling a transaction');
    await run(`UPDATE transactions SET status = 'cancelled', updated_by = ?, updated_at = ? WHERE id = ?`, user.id, nowIso(), id);
    await unpostLedger(id);
    await audit({
      user, action: 'CANCEL_TRANSACTION', entity: 'transaction', entityId: original.tx_number,
      oldValue: { status: original.status }, newValue: { status: 'cancelled' },
      reason: String(reason).trim(), ip,
    });
    return getTransaction(id);
  });
}

export async function refundTransaction(id, { reason, amount, currency }, user, ip) {
  const original = await one('SELECT * FROM transactions WHERE id = ?', id);
  if (!original) throw notFound('Transaction');
  if (original.status !== 'completed') throw badRequest('INVALID_STATUS', 'Only completed transactions can be refunded');
  if (!reason || !String(reason).trim()) throw validationError('A reason is required to refund a transaction');

  let refundAmount =
    amount === undefined || amount === null
      ? original.amount_minor
      : toMinor(amount);
  if (refundAmount === null || refundAmount <= 0) throw validationError('Please enter the refund amount');
  const cur = currency || original.currency;
  if (cur !== original.currency) throw validationError('Refund currency must match the original transaction');

  const refunded = (
    await one(
      `SELECT COALESCE(SUM(t.amount_minor),0) AS total FROM transactions t
       WHERE t.related_to = ? AND t.status = 'completed' AND t.type_id = (SELECT id FROM transaction_types WHERE code='refund')`,
      original.id
    )
  ).total;
  if (refunded + refundAmount > original.amount_minor) {
    throw validationError('Refund exceeds the remaining refundable amount of this transaction');
  }

  return transaction(async () => {
    const refundType = await getTypeByCode('refund');
    const refund = await coreCreate(
      {
        biz_date: today(),
        time: nowTime(),
        service_id: original.service_id,
        type_id: refundType.id,
        customer_id: original.customer_id,
        account_id: original.account_id,
        counter_account_id: original.counter_account_id,
        direction: original.direction === 'in' ? 'out' : 'in',
        amount_minor: refundAmount,
        currency: original.currency,
        commission_minor: 0,
        payment_method: original.payment_method,
        reference_no: original.reference_no,
        description: `Refund for ${original.tx_number}`,
        status: 'completed',
        related_to: original.id,
      },
      user
    );
    await audit({
      user, action: 'REFUND_TRANSACTION', entity: 'transaction', entityId: original.tx_number,
      oldValue: { refunded_minor: refunded },
      newValue: { refunded_minor: refunded + refundAmount, refund_tx: refund.tx_number },
      reason: String(reason).trim(), ip,
    });
    return { original: await getTransaction(original.id), refund: await getTransaction(refund.id) };
  });
}

// ------------------------------------------------------------------
// Range summary used by dashboard + reports (grouped by currency)
// ------------------------------------------------------------------

export async function rangeSummary(from, to, extra = {}) {
  const where = ['t.biz_date >= ?', 't.biz_date <= ?'];
  const params = [from, to];
  if (extra.service_code) { where.push('s.code = ?'); params.push(extra.service_code); }
  if (extra.type_code) { where.push('tt.code = ?'); params.push(extra.type_code); }
  if (extra.currency) { where.push('t.currency = ?'); params.push(extra.currency); }
  const clause = `WHERE ${where.join(' AND ')} AND t.status = 'completed'`;
  return all(
    `SELECT t.currency,
            COUNT(*) AS tx_count,
            COALESCE(SUM(CASE WHEN t.direction = 'in'  THEN t.amount_minor ELSE 0 END), 0) AS inflow_minor,
            COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount_minor ELSE 0 END), 0) AS outflow_minor,
            COALESCE(SUM(t.commission_minor), 0) AS commission_minor
     FROM transactions t
     JOIN services s ON s.id = t.service_id
     JOIN transaction_types tt ON tt.id = t.type_id
     ${clause} GROUP BY t.currency`,
    ...params
  );
}

export { sumMinor };
