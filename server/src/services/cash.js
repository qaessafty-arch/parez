/** Cash management — expected cash, movements, per-currency accounting. */
import { getDb } from '../db/index.js';
import { today } from '../lib/dates.js';
import { accountBalance, accountMovement } from './ledger.js';

export function cashAccounts() {
  return getDb().prepare(`SELECT * FROM accounts WHERE kind = 'cash' AND is_active = 1 ORDER BY sort_order`).all();
}

/**
 * Cash position for a business date, per currency:
 *   opening + cash in - cash out = expected cash
 *   difference = actual counted - expected
 */
export function cashSnapshot(date = today()) {
  const db = getDb();
  const accounts = cashAccounts();
  const currencies = db.prepare('SELECT code FROM currencies WHERE is_active = 1 ORDER BY sort_order').all().map((c) => c.code);

  const result = [];
  for (const currency of currencies) {
    let opening = 0;
    let inn = 0;
    let out = 0;
    let accountIds = [];
    for (const a of accounts) {
      opening += accountBalance(a.id, currency, prevDate(date));
      const m = accountMovement(a.id, currency, date, date);
      inn += m.in_minor;
      out += m.out_minor;
      accountIds.push(a.id);
    }
    if (accountIds.length === 0 || (opening === 0 && inn === 0 && out === 0)) continue;
    const expected = opening + inn - out;
    result.push({
      currency,
      opening_minor: opening,
      cash_in_minor: inn,
      cash_out_minor: out,
      expected_minor: expected,
      account_ids: accountIds,
    });
  }
  return { date, rows: result };
}

function prevDate(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** Today's cash movements with full context (who/what/why). */
export function cashMovements({ from = null, to = null, limit = 200 } = {}) {
  const db = getDb();
  const accountIds = cashAccounts().map((a) => a.id);
  if (accountIds.length === 0) return { total: 0, rows: [] };
  const marks = accountIds.map(() => '?').join(',');
  const where = [`l.account_id IN (${marks})`];
  const params = [...accountIds];
  if (from) { where.push('l.biz_date >= ?'); params.push(from); }
  if (to) { where.push('l.biz_date <= ?'); params.push(to); }
  const clause = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM ledger_entries l ${clause}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT l.id, l.direction, l.amount_minor, l.currency, l.biz_date, l.created_at,
              t.tx_number, t.description, t.payment_method, t.reference_no, t.status,
              tt.name AS type_name, tt.code AS type_code,
              s.name AS service_name, s.code AS service_code,
              c.full_name AS customer_name,
              u.full_name AS created_by_name
       FROM ledger_entries l
       LEFT JOIN transactions t ON t.id = l.txn_id
       LEFT JOIN transaction_types tt ON tt.id = t.type_id
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.created_by
       ${clause}
       ORDER BY l.biz_date DESC, l.id DESC
       LIMIT ?`
    )
    .all(...params, Math.min(limit, 500));
  return { total, rows };
}

/** Per-account balances (all accounts, grouped by currency). */
export function allBalances(asOfDate = null) {
  const db = getDb();
  const currencies = db.prepare('SELECT code FROM currencies WHERE is_active = 1').all().map((c) => c.code);
  const balances = [];
  for (const a of db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY sort_order').all()) {
    for (const currency of currencies) {
      const bal = accountBalance(a.id, currency, asOfDate);
      const movement = asOfDate ? null : null;
      void movement;
      if (currency === a.currency || bal !== 0) {
        balances.push({
          id: a.id, code: a.code, name: a.name, kind: a.kind,
          currency, balance_minor: bal,
          is_default_currency: currency === a.currency,
        });
      }
    }
  }
  return balances;
}
