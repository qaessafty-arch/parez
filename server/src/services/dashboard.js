/** Dashboard — today's financial situation, balances, chart data. */
import { getDb } from '../db/index.js';
import { today, resolveRange, addDays, yesterday } from '../lib/dates.js';
import { listTransactions, rangeSummary } from './transactions.js';
import { allBalances } from './cash.js';
import { isDayClosed } from './closing.js';
import { getSetting } from './settings.js';

export function dashboard({ range = 'today', from, to, currency } = {}) {
  const db = getDb();
  const span = from && to ? { from, to, label: 'custom' } : resolveRange(range);
  const primaryCurrency = currency || getSetting('default.currency', 'IQD');

  const summary = rangeSummary(span.from, span.to, { currency });
  const summaryAll = rangeSummary(span.from, span.to);

  const expenses = db
    .prepare(
      `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS total_minor, COUNT(*) AS count
       FROM expenses e JOIN transactions t ON t.id = e.txn_id
       WHERE t.biz_date >= ? AND t.biz_date <= ? AND t.status = 'completed'
       GROUP BY t.currency`
    )
    .all(span.from, span.to);

  const ronakiCollections = db
    .prepare(
      `SELECT currency, COALESCE(SUM(amount_minor),0) AS total_minor, COUNT(*) AS count
       FROM ronaki_payments WHERE biz_date >= ? AND biz_date <= ? GROUP BY currency`
    )
    .all(span.from, span.to);

  const customerPayments = db
    .prepare(
      `SELECT t.currency, COUNT(*) AS count, COALESCE(SUM(t.amount_minor),0) AS total_minor
       FROM transactions t JOIN transaction_types tt ON tt.id = t.type_id
       WHERE t.biz_date >= ? AND t.biz_date <= ? AND t.status = 'completed'
         AND tt.code IN ('customer_payment','payment_collection')
       GROUP BY t.currency`
    )
    .all(span.from, span.to);

  // Outstanding customer debt (credit sales minus payments), per currency
  const debt = db
    .prepare(
      `SELECT t.currency,
              SUM(CASE WHEN tt.code = 'credit_sale'     THEN t.amount_minor ELSE 0 END) -
              SUM(CASE WHEN tt.code = 'customer_payment' THEN t.amount_minor ELSE 0 END) AS outstanding_minor
       FROM transactions t JOIN transaction_types tt ON tt.id = t.type_id
       WHERE t.customer_id IS NOT NULL AND t.status = 'completed'
       GROUP BY t.currency`
    )
    .all()
    .filter((r) => r.outstanding_minor !== 0);

  const ronakiRemaining = db
    .prepare(
      `SELECT c.currency,
              SUM(c.total_required_minor - IFNULL(p.paid,0)) AS remaining_minor
       FROM ronaki_contracts c
       LEFT JOIN (SELECT contract_id, SUM(amount_minor) AS paid FROM ronaki_payments GROUP BY contract_id) p
         ON p.contract_id = c.id
       GROUP BY c.currency`
    )
    .all();

  const balances = allBalances(null);
  const byKind = (kind) => balances.filter((b) => b.kind === kind && b.currency === primaryCurrency);

  const recent = listTransactions({ limit: 8 }).rows;

  // 7-day inflow/outflow chart (primary currency)
  const chartEnd = span.to > today() ? today() : span.to;
  const chart = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(chartEnd, -i);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_minor ELSE 0 END),0) AS inflow_minor,
                COALESCE(SUM(CASE WHEN direction='out' THEN amount_minor ELSE 0 END),0) AS outflow_minor
         FROM transactions
         WHERE biz_date = ? AND status = 'completed' AND currency = ?`
      )
      .get(d, primaryCurrency);
    chart.push({ date: d, inflow_minor: row.inflow_minor, outflow_minor: row.outflow_minor });
  }

  const cardValue = (rows, key, cur = primaryCurrency) =>
    rows.find((r) => r.currency === cur)?.[key] ?? 0;

  return {
    range: span,
    primary_currency: primaryCurrency,
    currency_breakdown: summaryAll,
    cards: {
      transactions_count: summary.reduce((a, r) => a + r.tx_count, 0),
      revenue_minor: cardValue(summary, 'inflow_minor'),
      expenses_minor: cardValue(expenses, 'total_minor'),
      commission_minor: cardValue(summary, 'commission_minor'),
      outflow_minor: cardValue(summary, 'outflow_minor'),
      customer_payments_minor: cardValue(customerPayments, 'total_minor'),
      customer_payments_count: cardValue(customerPayments, 'count'),
      cash_balance_minor: byKind('cash').reduce((a, b) => a + b.balance_minor, 0),
      fastpay_balance_minor: balances.find((b) => b.code === 'FASTPAY' && b.currency === primaryCurrency)?.balance_minor ?? 0,
      nasswallet_balance_minor: balances.find((b) => b.code === 'NASSWALLET' && b.currency === primaryCurrency)?.balance_minor ?? 0,
      ronaki_collected_minor: cardValue(ronakiCollections, 'total_minor'),
      ronaki_remaining_minor: cardValue(ronakiRemaining, 'remaining_minor'),
      outstanding_minor: cardValue(debt, 'outstanding_minor'),
    },
    balances,
    ronaki_collections: ronakiCollections,
    debt_by_currency: debt,
    recent,
    chart,
    closed_today: isDayClosed(today()),
    last_backup_at: getSetting('backup.last_at', ''),
  };
}
