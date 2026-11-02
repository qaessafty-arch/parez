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

test('dashboard: a service with no transactions shows as a zero row', async () => {
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '1000', currency: 'IQD', commission: '0' }, user);
  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  const cardhouse = d.service_breakdown.find((r) => r.service_code === 'cardhouse');
  assert.ok(cardhouse, 'CardHouse is listed even with no activity');
  assert.equal(cardhouse.tx_count, 0);
  assert.equal(cardhouse.commission_minor, 0);
});

test('dashboard: every active service is listed, even with no activity, in sidebar order', async () => {
  await createTransaction({ service_code: 'fib', type_code: 'deposit', account_id: cash.id, amount: '2000', currency: 'IQD', commission: '40' }, user);
  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  const codes = d.service_breakdown.map((r) => r.service_code);
  for (const code of ['fastpay', 'nasswallet', 'fib', 'cardhouse', 'ronaki']) {
    assert.ok(codes.includes(code), `${code} must appear on the dashboard`);
  }
  const fastpay = d.service_breakdown.find((r) => r.service_code === 'fastpay');
  assert.equal(fastpay.tx_count, 0);
  assert.equal(fastpay.commission_minor, 0);
  const sortOrders = d.service_breakdown.map((r) => r.sort_order);
  assert.deepEqual(sortOrders, [...sortOrders].sort((a, b) => a - b), 'rows follow sidebar order');
});

test('dashboard and service page show the same commission for the same range', async () => {
  const { walletSummary } = await import('../src/services/wallets.js');
  await createTransaction({ service_code: 'fib', type_code: 'deposit', account_id: cash.id, amount: '2000', currency: 'IQD', commission: '40' }, user);
  await createTransaction({ service_code: 'fib', type_code: 'deposit', account_id: cash.id, amount: '500', currency: 'IQD', commission: '10' }, user);
  await createTransaction({ service_code: 'fastpay', type_code: 'deposit', account_id: cash.id, amount: '1000', currency: 'IQD', commission: '25' }, user);

  const d = await dashboard({ range: 'custom', from: TODAY, to: TODAY });
  const page = await walletSummary('fib', { range: 'custom', from: TODAY, to: TODAY });

  const onDashboard = d.service_breakdown.find((r) => r.service_code === 'fib' && r.currency === 'IQD');
  const onPage = page.period.find((r) => r.currency === 'IQD');
  assert.equal(onDashboard.commission_minor, onPage.commission_minor, 'same commission on both');
  assert.equal(onDashboard.inflow_minor, onPage.inflow_minor, 'same cash in on both');
  assert.equal(onDashboard.tx_count, onPage.tx_count, 'same count on both');
  assert.equal(page.commission[0].commission_minor, onDashboard.commission_minor, 'sidebar commission card matches');
});
