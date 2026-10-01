/**
 * IDs — unique, human-readable, never duplicated.
 *   TX-2026-000001   transactions
 *   CUS-2026-000001  customers
 *   PRZ-2026-000001  receipts
 *   RON-2026-000001  ronaki payments
 *   EXP-2026-000001  expenses
 * Allocation is atomic inside the caller's transaction (UPDATE ... RETURNING).
 */
import { today } from './dates.js';

export function yearNow() {
  return Number(today().slice(0, 4));
}

/**
 * Atomically increment and return the next sequence number.
 * Must be called inside a DB transaction for concurrency safety.
 */
export function nextSequence(db, name, year = yearNow()) {
  db.prepare('INSERT INTO sequences (name, year, last_value) VALUES (?, ?, 0) ON CONFLICT(name, year) DO NOTHING').run(name, year);
  const row = db
    .prepare('UPDATE sequences SET last_value = last_value + 1 WHERE name = ? AND year = ? RETURNING last_value')
    .get(name, year);
  return row.last_value;
}

export function formatSeq(prefix, year, n) {
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

export function nextTxNumber(db) {
  return formatSeq('TX', yearNow(), nextSequence(db, 'tx'));
}
export function nextCustomerCode(db) {
  return formatSeq('CUS', yearNow(), nextSequence(db, 'cus'));
}
export function nextReceiptNumber(db) {
  return formatSeq('PRZ', yearNow(), nextSequence(db, 'prz'));
}
export function nextRonakiPaymentNumber(db) {
  return formatSeq('RON', yearNow(), nextSequence(db, 'ron'));
}
export function nextExpenseNumber(db) {
  return formatSeq('EXP', yearNow(), nextSequence(db, 'exp'));
}
