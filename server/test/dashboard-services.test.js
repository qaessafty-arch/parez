/** Dashboard: each service's numbers stand on their own and add up to the total. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, account } from './helpers.js';
import { createTransaction } from '../src/services/transactions.js';
import { dashboard } from '../src/services/dashboard.js';

let user;
let cash;
const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

beforeEach(async () => {
  await freshDb();
  user = await makeUser({ username: 'boss', roleCode: 'admin', fullName: 'Shop Boss' });
  cash = await account('CASH');
});

test('dashboard: each service has its own count, cash in, commission', async () => {
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '1000', currency: 'IQD', commission: '25' }, user);
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '500', currency: 'IQD', commission: '0' }, user);
  await createTransaction({ service_code: 'fib', type_code: 'deposit', account_id: cash.id, amount: '2000', currency: 'IQD', commission: '40' }, user);

  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  const fastpay = d.service_breakdown.find((r) => r.service_code === 'fastpay' && r.currency === 'IQD');
  const fib = d.service_breakdown.find((r) => r.service_code === 'fib' && r.currency === 'IQD');

  assert.equal(fastpay.tx_count, 2);
  assert.equal(fastpay.inflow_minor, 150000, 'FastPay cash in: 1000 + 500');
  assert.equal(fastpay.commission_minor, 2500, 'FastPay commission: 25');
  assert.equal(fib.tx_count, 1);
  assert.equal(fib.commission_minor, 4000, 'FIB commission stays separate');
});

test('dashboard: the per-service commission adds up to the overall commission', async () => {
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '1000', currency: 'IQD', commission: '25' }, user);
  await createTransaction({ service_code: 'fib', type_code: 'deposit', account_id: cash.id, amount: '2000', currency: 'IQD', commission: '40' }, user);

  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  const sumOfServices = d.service_breakdown.reduce((a, r) => a + r.commission_minor, 0);
  const total = d.currency_breakdown.reduce((a, r) => a + r.commission_minor, 0);
  assert.equal(sumOfServices, total);
  assert.equal(total, 6500);
});

test('dashboard: a service with no transactions does not appear as a row', async () => {
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '1000', currency: 'IQD', commission: '0' }, user);
  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  assert.ok(!d.service_breakdown.some((r) => r.service_code === 'cardhouse'));
});
