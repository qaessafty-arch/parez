/** Wallet module summaries shared by FastPay and NassWallet. */
import { getDb } from '../db/index.js';
import { resolveRange } from '../lib/dates.js';
import { listTransactions, rangeSummary } from './transactions.js';
import { accountBalance } from './ledger.js';
import { getSetting } from './settings.js';

export function serviceOf(code) {
  const svc = getDb().prepare('SELECT * FROM services WHERE code = ?').get(code);
  return svc;
}

/**
 * Full module summary: today/period volume, balance, commission, recent activity.
 * Every figure is grouped per currency.
 */
export function walletSummary(serviceCode, { range = 'today', from, to, currency } = {}) {
  const svc = serviceOf(serviceCode);
  if (!svc) return null;
  const span = from && to ? { from, to } : resolveRange(range);

  const summaryRows = rangeSummary(span.from, span.to, { service_code: serviceCode, currency });
  const lifetime = rangeSummary('2000-01-01', '2999-12-31', { service_code: serviceCode, currency });

  const balances = [];
  if (svc.account_id) {
    const acct = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(svc.account_id);
    if (acct) {
      const curs = currency ? [currency] : distinctCurrencies(svc.account_id);
      for (const c of curs) {
        balances.push({
          account_id: acct.id,
          account_code: acct.code,
          account_name: acct.name,
          currency: c,
          balance_minor: accountBalance(acct.id, c),
          opening_balance_minor: acct.currency === c ? acct.opening_balance_minor : 0,
        });
      }
    }
  }

  const recent = listTransactions({ service_code: serviceCode, from: span.from, to: span.to, limit: 10 });

  return {
    service: { id: svc.id, code: svc.code, name: svc.name },
    range: span,
    period: summaryRows.map(sanitize),
    lifetime: lifetime.map(sanitize),
    balances,
    recent_total: recent.total,
    recent: recent.rows,
    // aliases for the UI
    volume: summaryRows.map(sanitize),
    commission: summaryRows.map((r) => ({ currency: r.currency, commission_minor: r.commission_minor })),
    count: summaryRows.reduce((a, r) => a + r.tx_count, 0),
  };
}

function sanitize(r) {
  return {
    currency: r.currency,
    tx_count: r.tx_count,
    inflow_minor: r.inflow_minor,
    outflow_minor: r.outflow_minor,
    commission_minor: r.commission_minor,
    net_volume_minor: r.inflow_minor - r.outflow_minor,
  };
}

function distinctCurrencies(accountId) {
  const rows = getDb()
    .prepare(`SELECT DISTINCT currency FROM ledger_entries WHERE account_id = ?`)
    .all(accountId);
  const def = getDb().prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId);
  const set = new Set(rows.map((r) => r.currency));
  if (def) set.add(def.currency);
  return [...set];
}

/** Wallet default account code (used by the create forms). */
export function walletAccount(serviceCode) {
  const svc = serviceOf(serviceCode);
  if (!svc || !svc.account_id) return null;
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(svc.account_id);
}
