/** Wallet module summaries shared by FastPay and NassWallet. */
import { all, one } from '../db/index.js';
import { resolveRange } from '../lib/dates.js';
import { listTransactions, rangeSummary } from './transactions.js';
import { accountBalance } from './ledger.js';

export async function serviceOf(code) {
  return one('SELECT * FROM services WHERE code = ?', code);
}

/**
 * Full module summary: today/period volume, balance, commission, recent activity.
 * Every figure is grouped per currency.
 */
export async function walletSummary(serviceCode, { range = 'today', from, to, currency } = {}) {
  const svc = await serviceOf(serviceCode);
  if (!svc) return null;
  const span = from && to ? { from, to } : resolveRange(range);

  const summaryRows = await rangeSummary(span.from, span.to, { service_code: serviceCode, currency });
  const lifetime = await rangeSummary('2000-01-01', '2999-12-31', { service_code: serviceCode, currency });

  const balances = [];
  if (svc.account_id) {
    const acct = await one('SELECT * FROM accounts WHERE id = ?', svc.account_id);
    if (acct) {
      const curs = currency ? [currency] : await distinctCurrencies(svc.account_id);
      for (const c of curs) {
        balances.push({
          account_id: acct.id,
          account_code: acct.code,
          account_name: acct.name,
          currency: c,
          balance_minor: await accountBalance(acct.id, c),
          opening_balance_minor: acct.currency === c ? acct.opening_balance_minor : 0,
        });
      }
    }
  }

  const recent = await listTransactions({ service_code: serviceCode, from: span.from, to: span.to, limit: 10 });

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

async function distinctCurrencies(accountId) {
  const rows = await all(`SELECT DISTINCT currency FROM ledger_entries WHERE account_id = ?`, accountId);
  const def = await one('SELECT currency FROM accounts WHERE id = ?', accountId);
  const set = new Set(rows.map((r) => r.currency));
  if (def) set.add(def.currency);
  return [...set];
}

/** Wallet default account code (used by the create forms). */
export async function walletAccount(serviceCode) {
  const svc = await serviceOf(serviceCode);
  if (!svc || !svc.account_id) return null;
  return one('SELECT * FROM accounts WHERE id = ?', svc.account_id);
}
