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
import { one, run } from '../db/index.js';

export function yearNow() {
  return Number(today().slice(0, 4));
}

/**
 * Atomically increment and return the next sequence number.
 * Call inside transaction() so the number is never handed out twice.
 */
export async function nextSequence(name, year = yearNow()) {
  await run('INSERT INTO sequences (name, year, last_value) VALUES (?, ?, 0) ON CONFLICT(name, year) DO NOTHING', name, year);
  const row = await one(
    'UPDATE sequences SET last_value = last_value + 1 WHERE name = ? AND year = ? RETURNING last_value',
    name,
    year
  );
  return row.last_value;
}

export function formatSeq(prefix, year, n) {
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

export async function nextTxNumber() {
  return formatSeq('TX', yearNow(), await nextSequence('tx'));
}
export async function nextCustomerCode() {
  return formatSeq('CUS', yearNow(), await nextSequence('cus'));
}
export async function nextReceiptNumber() {
  return formatSeq('PRZ', yearNow(), await nextSequence('prz'));
}
export async function nextRonakiPaymentNumber() {
  return formatSeq('RON', yearNow(), await nextSequence('ron'));
}
export async function nextExpenseNumber() {
  return formatSeq('EXP', yearNow(), await nextSequence('exp'));
}
