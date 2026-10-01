/** Receipts — immutable print snapshots with unique numbers (PRZ-2026-000001). */
import { getDb, transaction } from '../db/index.js';
import { nextReceiptNumber } from '../lib/ids.js';
import { notFound, conflict } from '../lib/errors.js';
import { formatDisplayDate } from '../lib/dates.js';
import { shopInfo } from './settings.js';
import { audit } from './audit.js';

/** Build the immutable snapshot stored with the receipt. */
function buildSnapshot(txn, shop) {
  const db = getDb();
  const remaining = remainingFor(txn);
  return {
    shop: { name: shop.name, address: shop.address, phone: shop.phone, footer: shop.receipt_footer },
    transaction: {
      tx_number: txn.tx_number,
      date: txn.biz_date,
      date_display: formatDisplayDate(txn.biz_date),
      time: txn.time,
      service: txn.service_name,
      service_code: txn.service_code,
      type: txn.type_name,
      type_code: txn.type_code,
      amount_minor: txn.amount_minor,
      currency: txn.currency,
      commission_minor: txn.commission_minor,
      net_minor: txn.net_minor,
      direction: txn.direction,
      reference_no: txn.reference_no,
      description: txn.description,
      payment_method: txn.payment_method,
      status: txn.status,
    },
    customer: txn.customer_id
      ? { id: txn.customer_id, code: txn.customer_code, name: txn.customer_name, phone: txn.customer_phone }
      : null,
    remaining_balance: remaining,
    processed_by: txn.created_by_name,
  };
}

function remainingFor(txn) {
  if (txn.service_code !== 'ronaki' || !txn.customer_id) return null;
  const db = getDb();
  const contracts = db
    .prepare(
      `SELECT c.contract_number, c.total_required_minor, c.currency,
              IFNULL((SELECT SUM(rp.amount_minor) FROM ronaki_payments rp WHERE rp.contract_id = c.id),0) AS paid_minor
       FROM ronaki_contracts c WHERE c.customer_id = ?`
    )
    .all(txn.customer_id);
  return contracts.map((c) => ({
    contract_number: c.contract_number,
    currency: c.currency,
    total_minor: c.total_required_minor,
    paid_minor: c.paid_minor,
    remaining_minor: c.total_required_minor - c.paid_minor,
  }));
}

function loadFullTxn(txnId) {
  const db = getDb();
  const txn = db
    .prepare(
      `SELECT t.*, s.name AS service_name, s.code AS service_code,
              tt.name AS type_name, tt.code AS type_code,
              c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
              u.full_name AS created_by_name
       FROM transactions t
       JOIN services s ON s.id = t.service_id
       JOIN transaction_types tt ON tt.id = t.type_id
       LEFT JOIN customers c ON c.id = t.customer_id
       JOIN users u ON u.id = t.created_by
       WHERE t.id = ?`
    )
    .get(txnId);
  if (!txn) throw notFound('Transaction');
  return txn;
}

/**
 * Create (or return existing) receipt for a transaction.
 * Receipt numbers are unique and never reused.
 */
export function createReceiptForTransaction(txnId, user, ip, { silentDuplicate = false } = {}) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM receipts WHERE txn_id = ?').get(txnId);
  if (existing) {
    if (silentDuplicate) return mapReceipt(db, existing);
    throw conflict('RECEIPT_EXISTS', 'A receipt already exists for this transaction', { receipt_number: existing.receipt_number });
  }
  const txn = loadFullTxn(txnId);

  return transaction((conn) => {
    const shop = shopInfo();
    const snapshot = buildSnapshot(txn, shop);
    const receipt_number = nextReceiptNumber(conn);
    const r = conn
      .prepare(
        `INSERT INTO receipts (receipt_number, txn_id, customer_id, snapshot_json, currency, total_minor, created_by, is_demo)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        receipt_number,
        txn.id,
        txn.customer_id,
        JSON.stringify(snapshot),
        txn.currency,
        txn.amount_minor,
        user.id,
        txn.is_demo
      );
    const id = Number(r.lastInsertRowid);
    conn.prepare('UPDATE transactions SET receipt_id = ?, updated_at = ? WHERE id = ?').run(id, new Date().toISOString(), txn.id);
    return getReceipt(id);
  });
}

function mapReceipt(db, row) {
  return { ...row, snapshot: JSON.parse(row.snapshot_json) };
}

export function getReceipt(idOrNumber) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM receipts WHERE id = ? OR receipt_number = ?')
    .get(Number(idOrNumber) || 0, String(idOrNumber));
  if (!row) throw notFound('Receipt');
  return mapReceipt(db, row);
}

/** Reprint = fetch existing receipt and bump the print counter (history preserved). */
export function reprintReceipt(idOrNumber) {
  const db = getDb();
  const receipt = getReceipt(idOrNumber);
  db.prepare('UPDATE receipts SET print_count = print_count + 1, last_printed_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    receipt.id
  );
  return getReceipt(receipt.id);
}

export function listReceipts({ q = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (q) {
    where.push(`(r.receipt_number LIKE ? OR IFNULL(t.tx_number,'') LIKE ? OR IFNULL(c.full_name,'') LIKE ? OR IFNULL(c.phone,'') LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (from) { where.push('r.created_at >= ?'); params.push(`${from}T00:00:00Z`); }
  if (to) { where.push('r.created_at <= ?'); params.push(`${to}T23:59:59Z`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM receipts r LEFT JOIN transactions t ON t.id = r.txn_id LEFT JOIN customers c ON c.id = r.customer_id ${clause}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT r.id, r.receipt_number, r.currency, r.total_minor, r.print_count, r.created_at, r.is_demo,
              t.tx_number, c.full_name AS customer_name, c.phone AS customer_phone
       FROM receipts r
       LEFT JOIN transactions t ON t.id = r.txn_id
       LEFT JOIN customers c ON c.id = r.customer_id
       ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(limit, 200), offset);
  return { total, rows };
}

export function createReceiptManually(txnId, user, ip) {
  return createReceiptForTransaction(Number(txnId), user, ip, { silentDuplicate: false });
}
