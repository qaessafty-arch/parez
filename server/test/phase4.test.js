/** Phase 4 — central transaction system: creation, commission, ledger, duplicates, reversal, search. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, account, transaction as dbTx } from './helpers.js';
import { createCustomer } from '../src/services/customers.js';
import {
  createTransaction, listTransactions, getTransaction, updateTransaction,
  reverseTransaction, cancelTransaction, refundTransaction, rangeSummary,
} from '../src/services/transactions.js';
import { setSetting } from '../src/services/settings.js';
import { accountBalance } from '../src/services/ledger.js';
import { listAudit } from '../src/services/audit.js';

let db;
let user;
const newCus = async (name, phone) => createCustomer({ full_name: name, phone }, user);

beforeEach(async () => {
  await freshDb();
  user = await makeUser({ username: 'seller', roleCode: 'employee', fullName: 'Cashier' });
  await setSetting('commission.rules', JSON.stringify([
    { service_code: 'fastpay', type_code: '*', currency: 'IQD', percent: 1 },
    { service_code: 'nasswallet', type_code: '*', currency: 'IQD', percent: 1 },
  ]));
});

test('Phase4: FastPay transaction — commission auto-calculated, ledger posted', async () => {
  const c = await newCus('Ahmed Ali', '07501234567');
  const fp = await account('FASTPAY');

  const txn = await createTransaction(
    { service_code: 'fastpay', type_code: 'withdrawal', customer_id: c.id, account_id: fp.id,
      amount: 250000, currency: 'IQD', reference_no: 'FP-778899' },
    user
  );
  assert.match(txn.tx_number, /^TX-\d{4}-\d{6}$/);
  assert.equal(txn.amount_minor, 25000000);
  assert.equal(txn.commission_minor, 250000, '1% of 250,000 = 2,500 IQD');
  assert.equal(txn.net_minor, 24750000);
  assert.equal(txn.currency, 'IQD');

  // OUT posts amount - commission
  assert.equal(await accountBalance(fp.id, 'IQD'), -24750000);
});

test('Phase4: NassWallet transaction posts to its own account (not cash)', async () => {
  const c = await newCus('Sara Omar', '07701112233');
  const nw = await account('NASSWALLET');
  const cash = await account('CASH');

  const txn = await createTransaction(
    { service_code: 'nasswallet', type_code: 'deposit', customer_id: c.id, account_id: nw.id,
      amount: 500000, currency: 'IQD' },
    user
  );
  assert.equal(txn.commission_minor, 500000); // 1% of 500,000 = 5,000 IQD
  assert.equal(await accountBalance(nw.id, 'IQD'), 50000000, 'IN posts full amount');
  assert.equal(await accountBalance(cash.id, 'IQD'), 0, 'cash untouched');
});

test('Phase4: explicit commission overrides rules and is validated', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 100000, currency: 'IQD', commission: 0 },
    user
  );
  assert.equal(t.commission_minor, 0);

  await assert.rejects(async () => await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 1000, currency: 'IQD', commission: 5000 }, user),
    /Commission cannot exceed/
  );
  await assert.rejects(async () => await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 0, currency: 'IQD' }, user),
    /amount/i
  );
  await assert.rejects(async () => await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 100, currency: 'EUR' }, user),
    /currency|Unknown/i
  );
});

test('Phase4: cash balance = opening + in - out (multi transaction)', async () => {
  const cash = await account('CASH');
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 500000, currency: 'IQD', commission: 0 }, user);
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 300000, currency: 'IQD', commission: 0 }, user);
  await createTransaction({ service_code: 'other', type_code: 'cash_out', account_id: cash.id, amount: 45000, currency: 'IQD', commission: 0 }, user);
  assert.equal(await accountBalance(cash.id, 'IQD'), 75500000); // 500,000 + 300,000 - 45,000
});

test('Phase4: duplicate detection — reference number and same-day similarity', async () => {
  const c = await newCus('Ahmed Ali', '07501234567');
  const fp = await account('FASTPAY');
  const base = {
    service_code: 'fastpay', type_code: 'withdrawal', customer_id: c.id, account_id: fp.id,
    amount: 100000, currency: 'IQD', reference_no: 'REF-1',
  };
  await createTransaction(base, user);

  // same reference => duplicate
  let err = null;
  try {
    await createTransaction(base, user);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'duplicate must be blocked');
  assert.equal(err.code, 'DUPLICATE_SUSPECTED');
  assert.ok(err.details.duplicates.length >= 1);

  // same customer/amount/date/account/type without reference => duplicate too
  err = null;
  try {
    await createTransaction({ ...base, reference_no: 'REF-2' }, user);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'similar transaction must be flagged');

  // force + reason => allowed and audited
  const forced = await createTransaction({ ...base, reference_no: 'REF-3', force: true, force_reason: 'Confirmed by customer' }, user);
  assert.ok(forced.id);
  const log = await listAudit({ action: 'CREATE_TRANSACTION' });
  assert.ok(log.rows.some((r) => String(r.reason || '').includes('Confirmed by customer')));
});

test('Phase4: reversal — original kept, ledger exactly inverted, reason required', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 200000, currency: 'IQD', commission: 0 },
    user
  );
  assert.equal(await accountBalance(cash.id, 'IQD'), 20000000);

  await assert.rejects(() => reverseTransaction(t.id, { reason: '' }, user), /reason/i);

  const result = await reverseTransaction(t.id, { reason: 'Customer entered wrong amount' }, user, '127.0.0.1');
  assert.equal(result.original.status, 'reversed');
  assert.equal(result.reversal.status, 'completed');
  assert.equal(await accountBalance(cash.id, 'IQD'), 0, 'balance must return to zero after reversal');

  const detail = await getTransaction(t.id);
  assert.equal(detail.status, 'reversed');
  assert.ok(detail.audit.some((a) => a.action === 'REVERSE_TRANSACTION'));
  assert.ok(detail.audit.find((a) => a.action === 'REVERSE_TRANSACTION').reason.includes('wrong amount'));

  // reversing twice is blocked
  await assert.rejects(() => reverseTransaction(t.id, { reason: 'again' }, user), /already been reversed/i);
  // editing a reversed transaction is blocked
  await assert.rejects(() => updateTransaction(t.id, { amount: 1 }, user), /reversed/i);
});

test('Phase4: pending transaction can be cancelled (ledger removed, row kept)', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 77000, currency: 'IQD', commission: 0, status: 'pending' },
    user
  );
  assert.equal(await accountBalance(cash.id, 'IQD'), 7700000);
  await assert.rejects(() => cancelTransaction(t.id, { reason: '' }, user), /reason/i);
  await cancelTransaction(t.id, { reason: 'Customer changed mind' }, user);
  assert.equal(await accountBalance(cash.id, 'IQD'), 0);
  assert.equal((await getTransaction(t.id)).status, 'cancelled');
  assert.equal((await getTransaction(t.id)).ledger.length, 0, 'ledger entries removed for cancelled pending txns');
  assert.ok((await listAudit({ action: 'CANCEL_TRANSACTION' })).total >= 1);
});

test('Phase4: editing a completed transaction requires a reason and audits old/new values', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 100000, currency: 'IQD', commission: 0 },
    user
  );

  await assert.rejects(() => updateTransaction(t.id, { amount_minor: 12000000 }, user), /reason/i);

  await updateTransaction(t.id, { amount_minor: 12000000, reason: 'Customer entered wrong amount' }, user, '127.0.0.1');
  const detail = await getTransaction(t.id);
  assert.equal(detail.amount_minor, 12000000);
  assert.equal(await accountBalance(cash.id, 'IQD'), 12000000, 'ledger re-posted after edit');
  const edit = detail.audit.find((a) => a.action === 'EDIT_TRANSACTION');
  assert.ok(edit, 'edit must be audited');
  assert.equal(JSON.parse(edit.old_value).amount_minor, 10000000);
  assert.equal(JSON.parse(edit.new_value).amount_minor, 12000000);
  assert.ok(edit.reason.includes('wrong amount'));
});

test('Phase4: partial refund is linked and capped', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'customer_payment', account_id: cash.id, amount: 100000, currency: 'IQD', commission: 0 },
    user
  );
  await refundTransaction(t.id, { reason: 'Overcharge', amount: 40000 }, user);
  assert.equal(await accountBalance(cash.id, 'IQD'), 6000000, '100,000 in - 40,000 refund');

  // over-refund blocked
  await assert.rejects(() => refundTransaction(t.id, { reason: 'More', amount: 70000 }, user), /exceeds/i);
  // refund without reason blocked
  await assert.rejects(() => refundTransaction(t.id, { reason: '' }, user), /reason/i);
});

test('Phase4: search & filters — by text, service, date range, status; totals grouped by currency', async () => {
  const c = await newCus('Ahmed Ali', '07501234567');
  const cash = await account('CASH');
  const fp = await account('FASTPAY');

  await createTransaction({ service_code: 'fastpay', type_code: 'withdrawal', customer_id: c.id, account_id: fp.id, amount: 250000, currency: 'IQD', reference_no: 'SRCH-1', commission: 0 }, user);
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 50000, currency: 'IQD', commission: 0, biz_date: '2026-09-29' }, user);
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 75, currency: 'USD', commission: 0 }, user);

  const all = await listTransactions({});
  assert.equal(all.total, 3);

  const byRef = await listTransactions({ q: 'SRCH-1' });
  assert.equal(byRef.total, 1);

  const byName = await listTransactions({ q: 'Ahmed' });
  assert.equal(byName.total, 1);

  const byService = await listTransactions({ service_code: 'fastpay' });
  assert.equal(byService.total, 1);

  const byDate = await listTransactions({ from: '2026-09-29', to: '2026-09-29' });
  assert.equal(byDate.total, 1);

  // totals grouped per currency — never mixed
  const iqd = byService.totals.find((t) => t.currency === 'IQD');
  assert.equal(iqd.outflow_minor, 25000000);
  const summary = await rangeSummary('2026-01-01', '2026-12-31');
  const cur = Object.fromEntries(summary.map((s) => [s.currency, s]));
  assert.equal(cur.IQD.inflow_minor, 5000000);
  assert.equal(cur.USD.inflow_minor, 7500);
});

test('Phase4: transaction detail exposes ledger, creator, and full audit history', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 12345, currency: 'IQD', commission: 0, reference_no: 'X-9' },
    user
  );
  const detail = await getTransaction(t.id);
  assert.equal(detail.tx_number, t.tx_number);
  assert.equal(detail.created_by_name, 'Cashier');
  assert.equal(detail.ledger.length, 1);
  assert.equal(detail.ledger[0].direction, 'in');
  assert.ok(detail.audit.some((a) => a.action === 'CREATE_TRANSACTION'));

  // lookup by human number also works
  const byNumber = await getTransaction(t.tx_number);
  assert.equal(byNumber.id, t.id);
});

test('Phase4: transfer posts to both accounts and keeps conservation', async () => {
  const cash = await account('CASH');
  const fp = await account('FASTPAY');
  await createTransaction(
    { service_code: 'fastpay', type_code: 'transfer', account_id: cash.id, counter_account_id: fp.id,
      amount: 1000000, currency: 'IQD', commission: 0, description: 'Top up FastPay float from cash' },
    user
  );
  assert.equal(await accountBalance(cash.id, 'IQD'), -100000000);
  assert.equal(await accountBalance(fp.id, 'IQD'), 100000000);

  // transfer without counter account rejected
  await assert.rejects(async () => await createTransaction({ service_code: 'fastpay', type_code: 'transfer', account_id: cash.id, amount: 10, currency: 'IQD' }, user),
    /destination account/
  );
});

