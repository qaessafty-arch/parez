/** Phase 3 — customer management: CRUD, search, history, validation. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, transaction } from './helpers.js';
import { createCustomer, searchCustomers, getCustomer, updateCustomer, customerHistory } from '../src/services/customers.js';
import { createTransaction } from '../src/services/transactions.js';
import { setSetting } from '../src/services/settings.js';
import { listAudit } from '../src/services/audit.js';
import { account, svc, typeOf } from './helpers.js';

let db;
let user;

beforeEach(() => {
  db = freshDb();
  user = makeUser(db, { username: 'emp', roleCode: 'employee', fullName: 'Test Employee' });
  setSetting('commission.rules', JSON.stringify([{ service_code: '*', type_code: '*', percent: 1 }]));
});

test('Phase3: creating a customer validates input and assigns a unique code', () => {
  const c1 = createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567', address: 'Akre' }, user);
  assert.match(c1.code, /^CUS-\d{4}-\d{6}$/);
  const c2 = createCustomer({ full_name: 'Sara Omar', phone: '07701112233' }, user);
  assert.notEqual(c1.code, c2.code);

  assert.throws(() => createCustomer({ full_name: 'A' }, user), /name/i);
  assert.throws(() => createCustomer({ full_name: 'Valid Name', phone: 'abc' }, user), /phone/i);
  assert.throws(() => createCustomer({ full_name: '   ' }, user), /name/i);

  const log = listAudit({ entity: 'customer' });
  assert.ok(log.rows.some((r) => r.action === 'CREATE_CUSTOMER'));
});

test('Phase3: search by name, phone and code', () => {
  createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  createCustomer({ full_name: 'Sara Omar', phone: '07701112233' }, user);
  createCustomer({ full_name: 'Karwan Bahra', phone: '07519998877' }, user);

  assert.equal(searchCustomers({ q: 'ahmed' }).total, 1);
  assert.equal(searchCustomers({ q: '0770' }).total, 1);
  assert.equal(searchCustomers({ q: 'karwan' }).rows[0].full_name, 'Karwan Bahra');
  assert.equal(searchCustomers({ q: 'CUS-' }).total, 3);
  assert.equal(searchCustomers({ q: '' }).total, 3);
  assert.equal(searchCustomers({ q: 'zzz' }).total, 0);
});

test('Phase3: editing a customer records an audit trail', () => {
  const c = createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  updateCustomer(c.id, { phone: '07509999999', notes: 'VIP' }, user, '127.0.0.1');
  const after = getCustomer(c.id);
  assert.equal(after.phone, '07509999999');
  assert.equal(after.notes, 'VIP');
  const log = listAudit({ entity: 'customer', action: 'EDIT_CUSTOMER' });
  assert.ok(log.total >= 1);
  assert.ok(log.rows.some((r) => String(r.new_value).includes('07509999999')));
});

test('Phase3: customer history — totals, fastpay/nasswallet split, ronaki, outstanding debt', () => {
  const c = createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  const cash = account(db, 'CASH');
  const fastpay = account(db, 'FASTPAY');
  const nass = account(db, 'NASSWALLET');

  // Service on credit (customer owes 100,000 IQD — no cash moves, pure debt record)
  createTransaction(
    { service_code: 'fastpay', type_code: 'credit_sale', customer_id: c.id, account_id: cash.id,
      amount: 100000, currency: 'IQD', commission: 0 },
    user
  );
  // Customer pays 60,000 cash toward the debt
  createTransaction(
    { service_code: 'other', type_code: 'customer_payment', customer_id: c.id, account_id: cash.id,
      amount: 60000, currency: 'IQD', commission: 0 },
    user
  );
  // FastPay withdrawal (volume 250,000, commission 1% auto = 2,500)
  createTransaction(
    { service_code: 'fastpay', type_code: 'withdrawal', customer_id: c.id, account_id: fastpay.id,
      amount: 250000, currency: 'IQD' },
    user
  );
  // NassWallet deposit
  createTransaction(
    { service_code: 'nasswallet', type_code: 'deposit', customer_id: c.id, account_id: nass.id,
      amount: 150000, currency: 'IQD' },
    user
  );

  const h = customerHistory(c.id);
  assert.equal(h.transactions.length, 4);
  assert.equal(h.totals.transaction_count, 4);

  const paid = h.totals.total_paid_by_currency.find((x) => x.currency === 'IQD');
  assert.equal(paid.amount_minor, 6000000 + 15000000); // customer_payment + nasswallet deposit (money IN)

  const debt = h.totals.outstanding_by_currency.find((x) => x.currency === 'IQD');
  assert.equal(debt.outstanding_minor, 10000000 - 6000000); // 100,000 owed - 60,000 paid

  const services = Object.fromEntries(h.totals.service_totals.map((s) => [s.code, s.volume_minor]));
  assert.equal(services.fastpay, 25000000);
  assert.equal(services.nasswallet, 15000000);
});

test('Phase3: history is per-currency (IQD and USD never combined)', () => {
  const c = createCustomer({ full_name: 'USD Client', phone: '07500000001' }, user);
  const cash = account(db, 'CASH');
  createTransaction({ service_code: 'other', type_code: 'customer_payment', customer_id: c.id, account_id: cash.id, amount: 100, currency: 'USD', commission: 0 }, user);
  createTransaction({ service_code: 'other', type_code: 'customer_payment', customer_id: c.id, account_id: cash.id, amount: 50000, currency: 'IQD', commission: 0 }, user);

  const h = customerHistory(c.id);
  const byCur = Object.fromEntries(h.totals.total_paid_by_currency.map((x) => [x.currency, x.amount_minor]));
  assert.equal(byCur.USD, 10000);
  assert.equal(byCur.IQD, 5000000);
  assert.equal(Object.keys(byCur).length, 2);
});

test('Phase3: missing customer returns 404-style error', () => {
  assert.throws(() => getCustomer(99999), /not found/i);
});
