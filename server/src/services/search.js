/** Global search — fast, forgiving search across all key entities. */
import { getDb } from '../db/index.js';

export function globalSearch(qRaw, { limit = 8 } = {}) {
  const q = String(qRaw || '').trim();
  if (q.length < 1) return { query: q, results: [] };
  const like = `%${q}%`;
  const db = getDb();
  const results = [];

  // Customers (name / phone / code)
  for (const c of db
    .prepare(
      `SELECT id, code, full_name, phone FROM customers
       WHERE full_name LIKE ? OR phone LIKE ? OR code LIKE ?
       ORDER BY full_name LIMIT ?`
    )
    .all(like, like, like, limit)) {
    results.push({
      kind: 'customer',
      id: c.id,
      title: c.full_name,
      subtitle: `${c.code}${c.phone ? ' · ' + c.phone : ''}`,
      link: `/customers?id=${c.id}`,
    });
  }

  // Transactions (tx number / reference / description / wallet number)
  for (const t of db
    .prepare(
      `SELECT t.id, t.tx_number, t.reference_no, t.amount_minor, t.currency, t.description, t.wallet_number,
              s.name AS service_name, c.full_name AS customer_name
       FROM transactions t
       JOIN services s ON s.id = t.service_id
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.tx_number LIKE ? OR IFNULL(t.reference_no,'') LIKE ? OR IFNULL(t.description,'') LIKE ?
          OR IFNULL(t.wallet_number,'') LIKE ?
       ORDER BY t.id DESC LIMIT ?`
    )
    .all(like, like, like, like, limit)) {
    results.push({
      kind: 'transaction',
      id: t.id,
      title: t.tx_number,
      subtitle: `${t.service_name} · ${t.amount_minor / 100} ${t.currency}${t.customer_name ? ' · ' + t.customer_name : ''}${t.reference_no ? ' · ref ' + t.reference_no : ''}`,
      link: `/transactions?id=${t.id}`,
    });
  }

  // Receipts
  for (const r of db
    .prepare(
      `SELECT id, receipt_number, currency, total_minor FROM receipts
       WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT ?`
    )
    .all(like, Math.min(limit, 5))) {
    results.push({
      kind: 'receipt',
      id: r.id,
      title: r.receipt_number,
      subtitle: `${r.total_minor / 100} ${r.currency}`,
      link: `/receipts?id=${encodeURIComponent(r.receipt_number)}`,
    });
  }

  // Ronaki contracts (contract number / house / customer ref)
  for (const c of db
    .prepare(
      `SELECT c.id, c.contract_number, c.house_unit, c.customer_ref, cu.full_name
       FROM ronaki_contracts c JOIN customers cu ON cu.id = c.customer_id
       WHERE c.contract_number LIKE ? OR IFNULL(c.house_unit,'') LIKE ? OR IFNULL(c.customer_ref,'') LIKE ?
         OR cu.full_name LIKE ? OR IFNULL(cu.phone,'') LIKE ?
       ORDER BY c.id DESC LIMIT ?`
    )
    .all(like, like, like, like, like, limit)) {
    results.push({
      kind: 'ronaki_contract',
      id: c.id,
      title: c.contract_number,
      subtitle: `${c.full_name}${c.house_unit ? ' · ' + c.house_unit : ''}`,
      link: `/ronaki?id=${c.id}`,
    });
  }

  // Wallet accounts (FastPay / NassWallet numbers recorded on transactions)
  for (const w of db
    .prepare(
      `SELECT wallet_number, COUNT(*) AS uses, MAX(biz_date) AS last_used
       FROM transactions
       WHERE IFNULL(wallet_number,'') <> '' AND wallet_number LIKE ?
       GROUP BY wallet_number ORDER BY last_used DESC LIMIT ?`
    )
    .all(like, Math.min(limit, 5))) {
    results.push({
      kind: 'wallet_account',
      id: w.wallet_number,
      title: w.wallet_number,
      subtitle: `${w.uses} transactions · last ${w.last_used}`,
      link: `/transactions?q=${encodeURIComponent(w.wallet_number)}`,
    });
  }

  // Expenses (supplier / number)
  for (const e of db
    .prepare(
      `SELECT e.id, e.expense_number, e.description, t.amount_minor, t.currency
       FROM expenses e JOIN transactions t ON t.id = e.txn_id
       WHERE e.expense_number LIKE ? OR e.description LIKE ? OR IFNULL(e.supplier,'') LIKE ?
       ORDER BY t.biz_date DESC LIMIT ?`
    )
    .all(like, like, like, Math.min(limit, 5))) {
    results.push({
      kind: 'expense',
      id: e.id,
      title: e.expense_number,
      subtitle: `${e.description} · ${e.amount_minor / 100} ${e.currency}`,
      link: `/expenses?q=${encodeURIComponent(e.expense_number)}`,
    });
  }

  return { query: q, results, total: results.length };
}
