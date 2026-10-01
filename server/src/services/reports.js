/**
 * Reports — every report is generated server-side with per-currency totals.
 * Export: CSV (UTF-8 BOM so Excel opens Kurdish/Arabic correctly) + JSON
 * (the client renders print-friendly HTML for PDF via the browser).
 */
import { getDb } from '../db/index.js';
import { resolveRange, today, formatDisplayDate } from '../lib/dates.js';
import { listTransactions, rangeSummary } from './transactions.js';
import { listExpenses } from './expenses.js';
import { ronakiReport } from './ronaki.js';
import { cashMovements } from './cash.js';
import { formatAmount } from '../lib/money.js';

export const REPORT_TYPES = [
  'daily', 'weekly', 'monthly', 'custom',
  'fastpay', 'nasswallet', 'ronaki', 'customer_debt',
  'expense', 'commission', 'cash_flow', 'transactions',
];

function rangeFor(type, { from, to }) {
  switch (type) {
    case 'daily': return resolveRange('today');
    case 'weekly': return resolveRange('week');
    case 'monthly': return resolveRange('month');
    case 'custom':
    case 'transactions':
    case 'fastpay':
    case 'nasswallet':
    case 'expense':
    case 'commission':
    case 'cash_flow':
    case 'ronaki':
    case 'customer_debt':
      return from && to ? resolveRange('custom', today(), { from, to }) : resolveRange('today');
    default:
      return resolveRange('today');
  }
}

export function runReport(type, params = {}) {
  if (!REPORT_TYPES.includes(type)) throw new Error(`Unknown report: ${type}`);
  const range = rangeFor(type, params);
  const base = {
    type,
    range,
    generated_at: new Date().toISOString(),
    currency_filter: params.currency || null,
  };

  switch (type) {
    case 'fastpay':
    case 'nasswallet':
      return { ...base, ...serviceReport(type, range, params) };

    case 'ronaki': {
      const r = ronakiReport({ from: range.from, to: range.to, q: params.q || '', project_id: params.project_id || null });
      return {
        ...base,
        title: 'Ronaki Project Collection Report',
        columns: [
          { key: 'contract_number', label: 'Contract' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'customer_phone', label: 'Phone' },
          { key: 'house_unit', label: 'House/Unit' },
          { key: 'total_required', label: 'Total Required' },
          { key: 'paid', label: 'Paid' },
          { key: 'remaining', label: 'Remaining' },
          { key: 'status', label: 'Status' },
        ],
        rows: r.contracts.map((c) => ({
          contract_number: c.contract_number,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone || '',
          house_unit: c.house_unit || '',
          total_required: `${formatAmount(c.total_required_minor)} ${c.currency}`,
          paid: `${formatAmount(c.paid_minor)} ${c.currency}`,
          remaining: `${formatAmount(c.remaining_minor)} ${c.currency}`,
          status: c.status,
        })),
        totals: r.summary.totals.map((t) => ({
          currency: t.currency,
          total_required: formatAmount(t.total_required_minor),
          paid: formatAmount(t.paid_minor),
          remaining: formatAmount(t.remaining_minor),
        })),
        meta: r.summary,
        payments: r.payments,
      };
    }

    case 'customer_debt':
      return { ...base, ...customerDebtReport(range, params) };

    case 'expense':
      return { ...base, ...expenseReport(range, params) };

    case 'commission':
      return { ...base, ...commissionReport(range, params) };

    case 'cash_flow':
      return { ...base, ...cashFlowReport(range, params) };

    case 'daily':
    case 'weekly':
    case 'monthly':
    case 'custom':
    case 'transactions':
    default:
      return { ...base, ...transactionReport(range, params) };
  }
}

function txnColumns() {
  return [
    { key: 'tx_number', label: 'ID' },
    { key: 'biz_date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'service_name', label: 'Service' },
    { key: 'type_name', label: 'Type' },
    { key: 'direction', label: 'In/Out' },
    { key: 'amount', label: 'Amount' },
    { key: 'commission', label: 'Commission' },
    { key: 'status', label: 'Status' },
    { key: 'reference_no', label: 'Reference' },
    { key: 'created_by_name', label: 'By' },
  ];
}

function mapTxn(r) {
  return {
    tx_number: r.tx_number,
    biz_date: r.biz_date,
    time: r.time,
    customer_name: r.customer_name || '-',
    service_name: r.service_name,
    type_name: r.type_name,
    direction: r.direction,
    amount: `${formatAmount(r.amount_minor)} ${r.currency}`,
    commission: `${formatAmount(r.commission_minor)} ${r.currency}`,
    status: r.status,
    reference_no: r.reference_no || '',
    created_by_name: r.created_by_name || '',
    _currency: r.currency,
    _amount_minor: r.amount_minor,
    _commission_minor: r.commission_minor,
  };
}

function transactionReport(range, params) {
  const list = listTransactions({
    from: range.from, to: range.to,
    service_code: params.service_code,
    type_code: params.type_code,
    customer_id: params.customer_id,
    currency: params.currency,
    status: params.status,
    q: params.q,
    limit: 1000,
  });
  const summary = rangeSummary(range.from, range.to, { currency: params.currency });
  return {
    title: 'Transaction Report',
    columns: txnColumns(),
    rows: list.rows.map(mapTxn),
    totals: summary.map((s) => ({
      currency: s.currency,
      count: s.tx_count,
      inflow: formatAmount(s.inflow_minor),
      outflow: formatAmount(s.outflow_minor),
      commission: formatAmount(s.commission_minor),
    })),
    summary,
    count: list.total,
  };
}

function serviceReport(serviceCode, range, params) {
  const list = listTransactions({
    from: range.from, to: range.to, service_code: serviceCode,
    currency: params.currency, q: params.q, status: params.status, limit: 1000,
  });
  const summary = rangeSummary(range.from, range.to, { service_code: serviceCode, currency: params.currency });
  return {
    title: `${serviceCode === 'fastpay' ? 'FastPay' : 'NassWallet'} Report`,
    columns: txnColumns(),
    rows: list.rows.map(mapTxn),
    totals: summary.map((s) => ({
      currency: s.currency,
      count: s.tx_count,
      inflow: formatAmount(s.inflow_minor),
      outflow: formatAmount(s.outflow_minor),
      commission: formatAmount(s.commission_minor),
    })),
    summary,
    count: list.total,
  };
}

function customerDebtReport(range, params) {
  const db = getDb();
  const where = [`t.customer_id IS NOT NULL`, `t.status = 'completed'`, `tt.code IN ('credit_sale','customer_payment')`];
  const p = [];
  if (params.currency) { where.push('t.currency = ?'); p.push(params.currency); }
  if (params.q) {
    where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR c.code LIKE ?)');
    const like = `%${params.q}%`;
    p.push(like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT c.code, c.full_name, c.phone, t.currency,
              SUM(CASE WHEN tt.code='credit_sale' THEN t.amount_minor ELSE 0 END) AS credit_minor,
              SUM(CASE WHEN tt.code='customer_payment' THEN t.amount_minor ELSE 0 END) AS paid_minor
       FROM transactions t
       JOIN transaction_types tt ON tt.id = t.type_id
       JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       GROUP BY c.id, t.currency
       HAVING credit_minor <> paid_minor
       ORDER BY (credit_minor - paid_minor) DESC`
    )
    .all(...p);

  const totals = {};
  for (const r of rows) {
    totals[r.currency] = (totals[r.currency] || 0) + (r.credit_minor - r.paid_minor);
  }
  return {
    title: 'Customer Debt Report',
    columns: [
      { key: 'code', label: 'Customer ID' },
      { key: 'full_name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'currency', label: 'Currency' },
      { key: 'credit', label: 'Billed' },
      { key: 'paid', label: 'Paid' },
      { key: 'outstanding', label: 'Outstanding' },
    ],
    rows: rows.map((r) => ({
      code: r.code,
      full_name: r.full_name,
      phone: r.phone || '',
      currency: r.currency,
      credit: formatAmount(r.credit_minor),
      paid: formatAmount(r.paid_minor),
      outstanding: formatAmount(r.credit_minor - r.paid_minor),
    })),
    totals: Object.entries(totals).map(([currency, v]) => ({ currency, outstanding: formatAmount(v) })),
    count: rows.length,
    range_ignored: true,
  };
}

function expenseReport(range, params) {
  const list = listExpenses({ from: range.from, to: range.to, currency: params.currency, category_id: params.category_id, q: params.q, limit: 1000 });
  return {
    title: 'Expense Report',
    columns: [
      { key: 'expense_number', label: 'Expense ID' },
      { key: 'biz_date', label: 'Date' },
      { key: 'category_name', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'amount', label: 'Amount' },
      { key: 'payment_method', label: 'Paid Via' },
      { key: 'created_by_name', label: 'By' },
    ],
    rows: list.rows.map((r) => ({
      expense_number: r.expense_number,
      biz_date: r.biz_date,
      category_name: r.category_name,
      description: r.description,
      supplier: r.supplier || '',
      amount: `${formatAmount(r.amount_minor)} ${r.currency}`,
      payment_method: r.payment_method,
      created_by_name: r.created_by_name || '',
    })),
    totals: list.totals.map((t) => ({ currency: t.currency, total: formatAmount(t.total_minor), count: t.count })),
    count: list.total,
  };
}

function commissionReport(range, params) {
  const db = getDb();
  const where = [`t.status = 'completed'`, 't.biz_date >= ?', 't.biz_date <= ?', 't.commission_minor > 0'];
  const p = [range.from, range.to];
  if (params.currency) { where.push('t.currency = ?'); p.push(params.currency); }
  if (params.service_code) { where.push('s.code = ?'); p.push(params.service_code); }
  const rows = db
    .prepare(
      `SELECT t.tx_number, t.biz_date, t.amount_minor, t.commission_minor, t.currency,
              s.name AS service_name, tt.name AS type_name, c.full_name AS customer_name, u.full_name AS created_by_name
       FROM transactions t
       JOIN services s ON s.id = t.service_id
       JOIN transaction_types tt ON tt.id = t.type_id
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY t.biz_date DESC, t.id DESC LIMIT 2000`
    )
    .all(...p);

  const byService = db
    .prepare(
      `SELECT s.name AS service_name, t.currency, SUM(t.commission_minor) AS commission_minor, COUNT(*) AS count
       FROM transactions t JOIN services s ON s.id = t.service_id
       WHERE t.status='completed' AND t.biz_date >= ? AND t.biz_date <= ? AND t.commission_minor > 0
         ${params.currency ? 'AND t.currency = ?' : ''}
       GROUP BY s.name, t.currency`
    )
    .all(...(params.currency ? [range.from, range.to, params.currency] : [range.from, range.to]));

  const totals = {};
  for (const r of rows) totals[r.currency] = (totals[r.currency] || 0) + r.commission_minor;

  return {
    title: 'Commission Report',
    columns: [
      { key: 'tx_number', label: 'ID' },
      { key: 'biz_date', label: 'Date' },
      { key: 'service_name', label: 'Service' },
      { key: 'type_name', label: 'Type' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'amount', label: 'Volume' },
      { key: 'commission', label: 'Commission' },
      { key: 'created_by_name', label: 'By' },
    ],
    rows: rows.map((r) => ({
      tx_number: r.tx_number,
      biz_date: r.biz_date,
      service_name: r.service_name,
      type_name: r.type_name,
      customer_name: r.customer_name || '-',
      amount: `${formatAmount(r.amount_minor)} ${r.currency}`,
      commission: `${formatAmount(r.commission_minor)} ${r.currency}`,
      created_by_name: r.created_by_name || '',
    })),
    totals: Object.entries(totals).map(([currency, v]) => ({ currency, commission: formatAmount(v) })),
    by_service: byService.map((b) => ({ service: b.service_name, currency: b.currency, commission: formatAmount(b.commission_minor), count: b.count })),
    count: rows.length,
    note: 'Commission is shop profit and is separate from transaction volume.',
  };
}

function cashFlowReport(range, params) {
  const db = getDb();
  const currency = params.currency || null;
  const cashIds = db.prepare(`SELECT id, code, name FROM accounts WHERE kind='cash' AND is_active=1`).all();
  const marks = cashIds.map(() => '?').join(',');
  const p = [range.from, range.to];
  let curClause = '';
  if (currency) { curClause = ' AND l.currency = ?'; p.push(currency); }

  const rows = db
    .prepare(
      `SELECT l.biz_date AS date, l.currency,
              COALESCE(SUM(CASE WHEN l.direction='in' THEN l.amount_minor ELSE 0 END),0) AS cash_in_minor,
              COALESCE(SUM(CASE WHEN l.direction='out' THEN l.amount_minor ELSE 0 END),0) AS cash_out_minor
       FROM ledger_entries l
       WHERE l.account_id IN (${marks}) AND l.biz_date >= ? AND l.biz_date <= ?${curClause}
       GROUP BY l.biz_date, l.currency
       ORDER BY l.biz_date, l.currency`
    )
    .all(...cashIds.map((c) => c.id), ...p);

  // opening cash before range
  const openings = {};
  for (const c of cashIds) {
    for (const cur of currency ? [currency] : distinctCur(c.id)) {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_minor ELSE 0 END),0) -
                  COALESCE(SUM(CASE WHEN direction='out' THEN amount_minor ELSE 0 END),0) AS net
           FROM ledger_entries WHERE account_id = ? AND currency = ? AND biz_date < ?`
        )
        .get(c.id, cur, range.from);
      const acct = db.prepare('SELECT opening_balance_minor, currency FROM accounts WHERE id = ?').get(c.id);
      const opening = acct.currency === cur ? acct.opening_balance_minor : 0;
      const key = cur;
      openings[key] = (openings[key] || 0) + opening + row.net;
    }
  }

  const running = { ...openings };
  const out = rows.map((r) => {
    const opening = running[r.currency] || 0;
    const closing = opening + r.cash_in_minor - r.cash_out_minor;
    running[r.currency] = closing;
    return {
      date: r.date,
      currency: r.currency,
      opening: formatAmount(opening),
      cash_in: formatAmount(r.cash_in_minor),
      cash_out: formatAmount(r.cash_out_minor),
      net: formatAmount(r.cash_in_minor - r.cash_out_minor),
      closing: formatAmount(closing),
    };
  });

  return {
    title: 'Cash Flow Report',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'currency', label: 'Currency' },
      { key: 'opening', label: 'Opening' },
      { key: 'cash_in', label: 'Cash In' },
      { key: 'cash_out', label: 'Cash Out' },
      { key: 'net', label: 'Net' },
      { key: 'closing', label: 'Closing' },
    ],
    rows: out,
    totals: [],
    count: out.length,
  };
}

function distinctCur(accountId) {
  const rows = getDb().prepare('SELECT DISTINCT currency FROM ledger_entries WHERE account_id = ?').all(accountId);
  const def = getDb().prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId);
  const set = new Set(rows.map((r) => r.currency));
  if (def) set.add(def.currency);
  return [...set];
}

// ------------------------------------------------------------------
// CSV export (UTF-8 BOM for Excel + Kurdish/Arabic)
// ------------------------------------------------------------------

export function toCsv(report) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push([report.title, `Range: ${report.range.from} to ${report.range.to}`, `Generated: ${report.generated_at}`].map(escape).join(','));
  lines.push('');
  if (report.columns) lines.push(report.columns.map((c) => escape(c.label)).join(','));
  for (const row of report.rows || []) {
    lines.push((report.columns || Object.keys(row).map((k) => ({ key: k, label: k }))).map((c) => escape(row[c.key])).join(','));
  }
  if (report.totals?.length) {
    lines.push('');
    lines.push(['TOTALS', ...report.totals.map((t) => escape(Object.values(t).join(' ')))].join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function reportFileName(type, range) {
  return `parez-${type}-${range.from}_${range.to}.csv`;
}

export { formatDisplayDate, cashMovements };
