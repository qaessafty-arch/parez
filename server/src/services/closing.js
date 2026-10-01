/**
 * Daily closing — end-of-day reconciliation per currency.
 *   Opening Cash + Cash In - Cash Out = Expected Cash
 *   Difference  = Actual Cash Counted - Expected Cash
 * Closing snapshots every account balance so history is frozen and auditable.
 */
import { getDb, transaction } from '../db/index.js';
import { today } from '../lib/dates.js';
import { toMinor } from '../lib/money.js';
import { badRequest, notFound, validationError } from '../lib/errors.js';
import { audit } from './audit.js';
import { cashSnapshot, allBalances } from './cash.js';
import { accountBalances } from './ledger.js';

export function closingPreview(date = today()) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency').all(date);

  const cash = cashSnapshot(date);

  const txnTotals = db
    .prepare(
      `SELECT t.currency, COUNT(*) AS tx_count,
              COALESCE(SUM(CASE WHEN t.direction='in' THEN t.amount_minor ELSE 0 END),0) AS inflow_minor,
              COALESCE(SUM(CASE WHEN t.direction='out' THEN t.amount_minor ELSE 0 END),0) AS outflow_minor,
              COALESCE(SUM(t.commission_minor),0) AS commission_minor
       FROM transactions t
       WHERE t.biz_date = ? AND t.status = 'completed'
       GROUP BY t.currency`
    )
    .all(date);

  const expenses = db
    .prepare(
      `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS total_minor, COUNT(*) AS count
       FROM expenses e JOIN transactions t ON t.id = e.txn_id
       WHERE t.biz_date = ? AND t.status = 'completed'
       GROUP BY t.currency`
    )
    .all(date);

  const ronaki = db
    .prepare(
      `SELECT currency, COALESCE(SUM(amount_minor),0) AS total_minor, COUNT(*) AS count
       FROM ronaki_payments WHERE biz_date = ? GROUP BY currency`
    )
    .all(date);

  const walletClosings = [];
  for (const code of ['FASTPAY', 'NASSWALLET', 'RONAKI', 'BANK']) {
    const acct = db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
    if (!acct) continue;
    walletClosings.push({
      code: acct.code,
      name: acct.name,
      currency: acct.currency,
      opening_balance_minor: acct.opening_balance_minor,
      closing_balance_minor: accountBalances(date).find((b) => b.id === acct.id && b.currency === acct.currency)?.balance_minor ?? 0,
    });
  }

  return {
    date,
    closed: existing.length > 0 ? existing : null,
    cash: cash.rows,
    totals: txnTotals,
    expenses,
    ronaki,
    accounts: allBalances(date),
    wallet_closings: walletClosings,
  };
}

/**
 * Close the business day. Creates one immutable row per active currency
 * (cash reconciliation + full balance snapshot).
 */
export function closeDay({ date = today(), actual = {}, note = '' }, user, ip) {
  const db = getDb();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError('Invalid date');
  if (date > today()) throw badRequest('FUTURE_DATE', 'You cannot close a future business day');

  const existing = db.prepare('SELECT currency FROM daily_closings WHERE closing_date = ?').all(date);
  if (existing.length > 0) {
    throw badRequest('ALREADY_CLOSED', `The day ${date} is already closed (${existing.map((e) => e.currency).join(', ')}). Reopen it first.`);
  }

  const snapshot = cashSnapshot(date);
  const targets = snapshot.rows.filter((r) => r.expected_minor !== 0 || r.cash_in_minor !== 0 || r.cash_out_minor !== 0);

  return transaction((conn) => {
    const balances = accountBalances(date);
    const totals = conn
      .prepare(
        `SELECT t.currency, COUNT(*) AS tx_count, COALESCE(SUM(t.commission_minor),0) AS commission_minor
         FROM transactions t WHERE t.biz_date = ? AND t.status = 'completed' GROUP BY t.currency`
      )
      .all(date);
    const expenses = Object.fromEntries(
      conn
        .prepare(
          `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS total
           FROM expenses e JOIN transactions t ON t.id = e.txn_id
           WHERE t.biz_date = ? AND t.status='completed' GROUP BY t.currency`
        )
        .all(date)
        .map((r) => [r.currency, r.total])
    );
    const ronaki = Object.fromEntries(
      conn
        .prepare(`SELECT currency, COALESCE(SUM(amount_minor),0) AS total FROM ronaki_payments WHERE biz_date = ? GROUP BY currency`)
        .all(date)
        .map((r) => [r.currency, r.total])
    );
    const countByCur = Object.fromEntries(totals.map((t) => [t.currency, t.tx_count]));
    const commissionByCur = Object.fromEntries(totals.map((t) => [t.currency, t.commission_minor]));

    const results = [];
    for (const row of targets) {
      const rawActual = actual[row.currency];
      let actualMinor;
      if (rawActual === undefined || rawActual === null || rawActual === '') {
        if (row.expected_minor !== 0) {
          throw validationError(`Please enter the actual cash counted for ${row.currency}`);
        }
        actualMinor = row.expected_minor;
      } else {
        // actual cash is counted and entered in display units (same convention as transactions)
        actualMinor = toMinor(rawActual);
        if (!Number.isSafeInteger(actualMinor) || actualMinor < 0) throw validationError(`Invalid actual cash amount for ${row.currency}`);
      }
      const difference = actualMinor - row.expected_minor;

      conn
        .prepare(
          `INSERT INTO daily_closings
            (closing_date, currency, opening_cash_minor, cash_in_minor, cash_out_minor,
             expected_cash_minor, actual_cash_minor, difference_minor, balances_json,
             total_transactions, total_commission_minor, total_expense_minor, ronaki_collected_minor,
             note, closed_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          date, row.currency, row.opening_minor, row.cash_in_minor, row.cash_out_minor,
          row.expected_minor, actualMinor, difference,
          JSON.stringify(balances),
          countByCur[row.currency] || 0,
          commissionByCur[row.currency] || 0,
          expenses[row.currency] || 0,
          ronaki[row.currency] || 0,
          String(note).trim() || null,
          user.id
        );
      results.push({ currency: row.currency, difference_minor: difference });
    }

    audit(conn, {
      user,
      action: 'DAILY_CLOSING',
      entity: 'daily_closing',
      entityId: date,
      newValue: {
        results: results.map((r) => ({ currency: r.currency, difference: `${r.difference_minor / 100}` })),
        note: note || null,
      },
      ip,
    });

    return { date, closings: getCloseings(date), differences: results };
  });
}

function getCloseings(date) {
  return getDb().prepare('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency').all(date);
}

/** True when every currency in the day's closing has been signed off. */
export function isDayClosed(date = today()) {
  const rows = getCloseings(date);
  if (rows.length === 0) return false;
  const currencies = getDb()
    .prepare("SELECT code FROM currencies WHERE is_active = 1")
    .all()
    .map((c) => c.code);
  if (currencies.length === 0) return rows.length > 0;
  return currencies.every((c) => rows.some((r) => r.currency === c));
}

/** Admin-only reopen: the removed closing is fully preserved inside the audit log. */
export function reopenDay({ date, reason }, user, ip) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM daily_closings WHERE closing_date = ?').all(date);
  if (rows.length === 0) throw notFound('Closing for that date');
  if (!reason || String(reason).trim().length < 3) throw validationError('A reason is required to reopen a day');

  transaction((conn) => {
    audit(conn, {
      user,
      action: 'DAILY_CLOSING_REOPEN',
      entity: 'daily_closing',
      entityId: date,
      oldValue: rows.map((r) => ({
        currency: r.currency,
        expected: r.expected_cash_minor,
        actual: r.actual_cash_minor,
        difference: r.difference_minor,
        closed_at: r.closed_at,
        note: r.note,
      })),
      reason: String(reason).trim(),
      ip,
    });
    conn.prepare('DELETE FROM daily_closings WHERE closing_date = ?').run(date);
  });
  return { date, reopened: true };
}

/** Closing history (most recent first). */
export function closingHistory({ limit = 60, offset = 0 } = {}) {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS c FROM (SELECT DISTINCT closing_date FROM daily_closings)').get().c;
  const days = db
    .prepare('SELECT DISTINCT closing_date FROM daily_closings ORDER BY closing_date DESC LIMIT ? OFFSET ?')
    .all(Math.min(limit, 365), offset);
  return {
    total,
    days: days.map((d) => ({
      date: d.closing_date,
      rows: db.prepare('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency').all(d.closing_date),
    })),
  };
}
