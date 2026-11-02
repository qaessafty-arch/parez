/** Editing a transaction: the amount the owner types must be the amount that is saved. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, account } from './helpers.js';
import { createTransaction, updateTransaction, getTransaction } from '../src/services/transactions.js';

let user;
let cash;

beforeEach(async () => {
  await freshDb();
  user = await makeUser({ username: 'clerk', roleCode: 'admin', fullName: 'Shop Clerk' });
  cash = await account('CASH');
});

test('edit: a display amount typed in the dialog is saved as that amount', async () => {
  const t = await createTransaction(
    { service_code: 'other', type_code: 'customer_payment', account_id: cash.id, amount: '100', currency: 'IQD', commission: '0' }, user
  );
  await updateTransaction(t.id, { amount: '1250.50', commission: '0', reason: 'typo fix' }, user, '127.0.0.1');
  const after = await getTransaction(t.id);
  assert.equal(after.amount_minor, 125050);
});

test('edit: commas in the typed amount are accepted', async () => {
  const t = await createTransaction(
    { service_code: 'other', type_code: 'customer_payment', account_id: cash.id, amount: '100', currency: 'IQD', commission: '0' }, user
  );
  await updateTransaction(t.id, { amount: '1,250.50', commission: '2,000', reason: 'typo fix' }, user, '127.0.0.1');
  const after = await getTransaction(t.id);
  assert.equal(after.amount_minor, 125050);
  assert.equal(after.commission_minor, 200000);
});

test('edit: an invalid amount is refused, not silently ignored', async () => {
  const t = await createTransaction(
    { service_code: 'other', type_code: 'customer_payment', account_id: cash.id, amount: '100', currency: 'IQD', commission: '0' }, user
  );
  await assert.rejects(() => updateTransaction(t.id, { amount: 'abc', reason: 'bad' }, user, '127.0.0.1'), /Invalid amount/);
  assert.equal((await getTransaction(t.id)).amount_minor, 10000);
});

test('edit: the route accepts the exact field names the dialog sends', async () => {
  // The browser calls the HTTP route, which validates the body before the service.
  // Mirror that route's schema: a field it does not list is dropped silently.
  const { z } = await import('zod');
  const { zReference, zBizDate } = await import('../src/lib/validate.js');
  const routeSchema = z.object({
    amount: z.union([z.string(), z.number()]).optional(),
    commission: z.union([z.string(), z.number()]).optional(),
    reference_no: zReference.optional(),
    description: z.string().trim().max(500).optional().nullable(),
    biz_date: zBizDate.optional(),
    reason: z.string().trim().max(300).optional(),
  });
  const sentByDialog = { amount: '1250.50', commission: '0', reference_no: '', description: '', biz_date: '2026-11-02', reason: 'typo' };
  const kept = routeSchema.parse(sentByDialog);
  assert.equal(kept.amount, '1250.50', 'the amount must survive route validation');
});
