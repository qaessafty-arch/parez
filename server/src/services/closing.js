/**
 * Daily closing — end-of-day reconciliation per currency.
 *   Opening Cash + Cash In - Cash Out = Expected Cash
 *   Difference  = Actual Cash Counted - Expected Cash
 * Closing snapshots every account balance so history is frozen and auditable.
 */
import { all, one, run, transaction } from '../db/index.js';
import { today } from '../lib/dates.js';
import { toMinor } from '../lib/money.js';
import { badRequest, notFound, validationError } from '../lib/errors.js';
import { audit } from './audit.js';
import { cashSnapshot, allBalances } from './cash.js';
import { accountBalances } from './ledger.js';

export async function closingPreview(date = today()) {
  const existing = await all('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency', date);

  const cash = await cashSnapshot(date);

  const txnTotals = await all(
    `SELECT t.currency, COUNT(*) AS tx_count,
            COALESCE(SUM(CASE WHEN t.direction='in' THEN t.amount_minor ELSE 0 END),0) AS inflow_minor,
            COALESCE(SUM(CASE WHEN t.direction='out' THEN t.amount_minor ELSE 0 END),0) AS outflow_minor,
            COALESCE(SUM(t.commission_minor),0) AS commission_minor
     FROM transactions t
     WHERE t.biz_date = ? AND t.status = 'completed'
     GROUP BY t.currency`,
    date
  );

  const expenses = await all(
    `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS total_minor, COUNT(*) AS count
     FROM expenses e JOIN transactions t ON t.id = e.txn_id
     WHERE t.biz_date = ? AND t.status = 'completed'
     GROUP BY t.currency`,
    date
  );

  const ronaki = await all(
    `SELECT currency, COALESCE(SUM(amount_minor),0) AS total_minor, COUNT(*) AS count
     FROM ronaki_payments WHERE biz_date = ? GROUP BY currency`,
    date
  );

  const walletClosings = [];
  for (const code of ['FASTPAY', 'NASSWALLET', 'RONAKI', 'BANK']) {
    const acct = await one('SELECT * FROM accounts WHERE code = ?', code);
    if (!acct) continue;
    walletClosings.push({
      code: acct.code,
      name: acct.name,
      currency: acct.currency,
      opening_balance_minor: acct.opening_balance_minor,
      closing_balance_minor: (await accountBalances(date)).find((b) => b.id === acct.id && b.currency === acct.currency)?.balance_minor ?? 0,
    });
  }

  // Dealer inventory (FIB, CardHouse, FastPay, NassWallet)
  const dealerInventory = [];
  for (const code of ['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']) {
    const acct = await one('SELECT * FROM accounts WHERE code = ?', code);
    if (!acct) continue;
    const inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', acct.id, acct.currency);
    if (inv) {
      dealerInventory.push({
        code: acct.code,
        name: acct.name,
        currency: acct.currency,
        wholesale_qty: inv.wholesale_qty,
        wholesale_cost_minor: inv.wholesale_cost_minor,
        retail_qty: inv.retail_qty,
        retail_revenue_minor: inv.retail_revenue_minor,
        current_qty: inv.current_qty,
        profit_minor: inv.profit_minor,
      });
    }
  }

  return {
    date,
    closed: existing.length > 0 ? existing : null,
    cash: cash.rows,
    totals: txnTotals,
    expenses,
    ronaki,
    accounts: await allBalances(date),
    wallet_closings: walletClosings,
    dealer_inventory: dealerInventory,
  };
}

/**
 * Close the business day. Creates one immutable row per active currency
 * (cash reconciliation + full balance snapshot).
 */
export async function closeDay({ date = today(), actual = {}, note = '' }, user, ip) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError('Invalid date');
  if (date > today()) throw badRequest('FUTURE_DATE', 'You cannot close a future business day');

  const existing = await all('SELECT currency FROM daily_closings WHERE closing_date = ?', date);
  if (existing.length > 0) {
    throw badRequest('ALREADY_CLOSED', `The day ${date} is already closed (${existing.map((e) => e.currency).join(', ')}). Reopen it first.`);
  }

  const snapshot = await cashSnapshot(date);
  const targets = snapshot.rows.filter((r) => r.expected_minor !== 0 || r.cash_in_minor !== 0 || r.cash_out_minor !== 0);

  return transaction(async () => {
    const balances = await accountBalances(date);
    const totals = await all(
      `SELECT t.currency, COUNT(*) AS tx_count, COALESCE(SUM(t.commission_minor),0) AS commission_minor
       FROM transactions t WHERE t.biz_date = ? AND t.status = 'completed' GROUP BY t.currency`,
      date
    );
    const expenses = Object.fromEntries(
      (
        await all(
          `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS total
           FROM expenses e JOIN transactions t ON t.id = e.txn_id
           WHERE t.biz_date = ? AND t.status='completed' GROUP BY t.currency`,
          date
        )
      ).map((r) => [r.currency, r.total])
    );
    const ronaki = Object.fromEntries(
      (
        await all(`SELECT currency, COALESCE(SUM(amount_minor),0) AS total FROM ronaki_payments WHERE biz_date = ? GROUP BY currency`, date)
      ).map((r) => [r.currency, r.total])
    );

    // Dealer inventory snapshot for closing
    const dealerInventory = [];
    for (const code of ['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']) {
      const acct = await one('SELECT * FROM accounts WHERE code = ?', code);
      if (!acct) continue;
      const inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', acct.id, acct.currency);
      if (inv) {
        dealerInventory.push({
          code: acct.code,
          name: acct.name,
          currency: acct.currency,
          wholesale_qty: inv.wholesale_qty,
          wholesale_cost_minor: inv.wholesale_cost_minor,
          retail_qty: inv.retail_qty,
          retail_revenue_minor: inv.retail_revenue_minor,
          current_qty: inv.current_qty,
          profit_minor: inv.profit_minor,
        });
      }
    }

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

      await run(
        `INSERT INTO daily_closings
          (closing_date, currency, opening_cash_minor, cash_in_minor, cash_out_minor,
           expected_cash_minor, actual_cash_minor, difference_minor, balances_json,
           total_transactions, total_commission_minor, total_expense_minor, ronaki_collected_minor,
           note, closed_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        date,
        row.currency,
        row.opening_minor,
        row.cash_in_minor,
        row.cash_out_minor,
        row.expected_minor,
        actualMinor,
        difference,
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

    await audit({
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

    return { date, closings: await getCloseings(date), differences: results };
  });
}

async function getCloseings(date) {
  return all('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency', date);
}

/** True when every currency in the day's closing has been signed off. */
export async function isDayClosed(date = today()) {
  const rows = await getCloseings(date);
  if (rows.length === 0) return false;
  const currencies = (await all('SELECT code FROM currencies WHERE is_active = 1')).map((c) => c.code);
  if (currencies.length === 0) return rows.length > 0;
  return currencies.every((c) => rows.some((r) => r.currency === c));
}

/** Admin-only reopen: the removed closing is fully preserved inside the audit log. */
export async function reopenDay({ date, reason }, user, ip) {
  const rows = await all('SELECT * FROM daily_closings WHERE closing_date = ?', date);
  if (rows.length === 0) throw notFound('Closing for that date');
  if (!reason || String(reason).trim().length < 3) throw validationError('A reason is required to reopen a day');

  await transaction(async () => {
    await audit({
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
    await run('DELETE FROM daily_closings WHERE closing_date = ?', date);
  });
  return { date, reopened: true };
}

/** Closing history (most recent first). */
export async function closingHistory({ limit = 60, offset = 0 } = {}) {
  const total = (await one('SELECT COUNT(*) AS c FROM (SELECT DISTINCT closing_date FROM daily_closings)')).c;
  const days = await all(
    'SELECT DISTINCT closing_date FROM daily_closings ORDER BY closing_date DESC LIMIT ? OFFSET ?',
    Math.min(limit, 365),
    offset
  );
  const out = [];
  for (const d of days) {
    out.push({
      date: d.closing_date,
      rows: await all('SELECT * FROM daily_closings WHERE closing_date = ? ORDER BY currency', d.closing_date),
    });
  }
  return { total, days: out };
}
