/**
 * Ledger — the single posting path for ALL money movement.
 *
 * RULES (documented in docs/SPEC.md, enforced + tested):
 *   direction 'in'       → account receives the FULL amount
 *                          (commission is part of it and stays in the account)
 *   direction 'out'      → account pays out amount - commission
 *                          (commission is retained inside the account)
 *   direction 'transfer' → source pays amount - commission,
 *                          destination receives amount - commission
 *   direction 'none'     → no ledger movement (e.g. credit_sale / debt records)
 *   reversal             → exact inverse of the original transaction's entries
 *
 * Balance(account, currency, asOf) =
 *   opening_balance_minor + SUM(in) - SUM(out)   -- grouped by currency, never mixed.
 */
import { all, one, run } from '../db/index.js';
import { subMinor, addMinor } from '../lib/money.js';

/** Compute ledger rows for a transaction (does not insert). */
export function computeLedgerRows(txn) {
  const { id, account_id, counter_account_id, direction, amount_minor, commission_minor, currency, biz_date } = txn;
  const commission = commission_minor || 0;
  if (direction === 'none') return [];

  if (direction === 'in') {
    if (amount_minor <= 0) return [];
    return [{ txn_id: id, account_id, currency, direction: 'in', amount_minor, biz_date }];
  }

  if (direction === 'out') {
    const net = amount_minor - commission;
    if (net <= 0) return [];
    return [{ txn_id: id, account_id, currency, direction: 'out', amount_minor: net, biz_date }];
  }

  if (direction === 'transfer') {
    if (!counter_account_id) return [];
    const net = amount_minor - commission;
    if (net <= 0) return [];
    return [
      { txn_id: id, account_id, currency, direction: 'out', amount_minor: net, biz_date },
      { txn_id: id, account_id: counter_account_id, currency, direction: 'in', amount_minor: net, biz_date },
    ];
  }

  return [];
}

/** Ledger rows that exactly invert a completed transaction (for reversals). */
export async function computeReversalRows(txn) {
  const original = await one('SELECT * FROM transactions WHERE id = ?', txn.reversal_of);
  if (!original) return [];
  const origRows = await all('SELECT * FROM ledger_entries WHERE txn_id = ?', original.id);
  const date = txn.biz_date;
  return origRows
    .filter((r) => r.amount_minor > 0)
    .map((r) => ({
      txn_id: txn.id,
      account_id: r.account_id,
      currency: r.currency,
      direction: r.direction === 'in' ? 'out' : 'in',
      amount_minor: r.amount_minor,
      biz_date: date,
    }));
}

/** Insert ledger entries for a transaction. Must run inside a transaction. */
export async function postLedger(txn) {
  const rows = txn.reversal_of ? await computeReversalRows(txn) : computeLedgerRows(txn);
  for (const r of rows) {
    await run(
      `INSERT INTO ledger_entries (txn_id, account_id, currency, direction, amount_minor, biz_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      r.txn_id,
      r.account_id,
      r.currency,
      r.direction,
      r.amount_minor,
      r.biz_date
    );
  }
  return rows.length;
}

/** Remove ledger entries for a transaction (only used when rolling back an unsaved insert). */
export async function unpostLedger(txnId) {
  await run('DELETE FROM ledger_entries WHERE txn_id = ?', txnId);
}

/**
 * Balance of one account in one currency, including opening balance.
 * @param {number} accountId
 * @param {string} currency
 * @param {string|null} asOfDate inclusive business date (YYYY-MM-DD)
 */
export async function accountBalance(accountId, currency, asOfDate = null) {
  const account = await one('SELECT * FROM accounts WHERE id = ?', accountId);
  if (!account) return 0;
  // Accounts may hold multiple currencies (e.g. USD in the cash drawer).
  // The opening balance only applies to the account's default currency.
  const opening = account.currency === currency ? account.opening_balance_minor : 0;
  const params = [accountId, currency];
  let dateClause = '';
  if (asOfDate) {
    dateClause = ' AND biz_date <= ?';
    params.push(asOfDate);
  }
  const row = await one(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount_minor ELSE 0 END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_minor ELSE 0 END), 0) AS outflow
     FROM ledger_entries
     WHERE account_id = ? AND currency = ?${dateClause}`,
    ...params
  );
  return addMinor(opening, subMinor(row.inflow, row.outflow));
}

/** All account balances keyed by currency (never mixes currencies). */
export async function accountBalances(asOfDate = null) {
  const accounts = await all('SELECT * FROM accounts WHERE is_active = 1 ORDER BY sort_order, id');
  const params = [];
  let dateClause = '';
  if (asOfDate) {
    dateClause = ' WHERE biz_date <= ?';
    params.push(asOfDate);
  }
  const sums = await all(
    `SELECT account_id, currency,
            COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount_minor ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_minor ELSE 0 END), 0) AS outflow
     FROM ledger_entries${dateClause}
     GROUP BY account_id, currency`,
    ...params
  );
  const map = new Map();
  for (const s of sums) {
    if (!map.has(`${s.account_id}|${s.currency}`)) map.set(`${s.account_id}|${s.currency}`, s);
  }
  const out = [];
  const seen = new Set();
  const build = (a, currency, inflow, outflow) => {
    const opening = a.currency === currency ? a.opening_balance_minor : 0;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      kind: a.kind,
      currency,
      balance_minor: addMinor(opening, subMinor(inflow, outflow)),
      inflow_minor: inflow,
      outflow_minor: outflow,
    };
  };
  for (const a of accounts) {
    const s = map.get(`${a.id}|${a.currency}`);
    if (s) {
      seen.add(`${a.id}|${a.currency}`);
      out.push(build(a, a.currency, s.inflow, s.outflow));
    } else {
      out.push(build(a, a.currency, 0, 0));
    }
  }
  // Secondary currencies held by these accounts (e.g. USD in cash drawer)
  for (const s of sums) {
    const key = `${s.account_id}|${s.currency}`;
    if (seen.has(key)) continue;
    const a = accounts.find((x) => x.id === s.account_id);
    if (!a) continue;
    out.push(build(a, s.currency, s.inflow, s.outflow));
  }
  return out;
}

/** Day movement for an account: returns {in_minor, out_minor} for a business date range. */
export async function accountMovement(accountId, currency, from, to) {
  const row = await one(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount_minor ELSE 0 END), 0) AS in_minor,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_minor ELSE 0 END), 0) AS out_minor
     FROM ledger_entries WHERE account_id = ? AND currency = ? AND biz_date >= ? AND biz_date <= ?`,
    accountId,
    currency,
    from,
    to
  );
  return { in_minor: row.in_minor, out_minor: row.out_minor };
}

/** Find an account by code (cached per call site is not needed — cheap query). */
export async function getAccountByCode(code) {
  return one('SELECT * FROM accounts WHERE code = ?', code);
}
