/** Phase 7 — Ronaki Project: contracts, payments, automatic remaining balance. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, account } from './helpers.js';
import { createCustomer } from '../src/services/customers.js';
import {
  createContract, getContract, listContracts, addPayment, ronakiReport, updateContract,
} from '../src/services/ronaki.js';
import { createReceiptForTransaction, getReceipt, reprintReceipt } from '../src/services/receipts.js';
import { accountBalance } from '../src/services/ledger.js';
import { listAudit } from '../src/services/audit.js';

let db;
let user;
let customer;
let project;

beforeEach(() => {
  db = freshDb();
  user = makeUser(db, { username: 'ronaki_clerk', roleCode: 'employee', fullName: 'Ronaki Clerk' });
  customer = createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  project = db.prepare('SELECT * FROM ronaki_projects LIMIT 1').get();
});

function makeContract(total = 1000000) {
  return createContract(
    { contract_number: 'R-1042', project_id: project.id, customer_id: customer.id,
      house_unit: 'H-12', total_required: total, currency: 'IQD', due_date: null },
    user
  );
}

test('Phase7: create contract — duplicate contract numbers rejected, remaining auto-calculated', () => {
  const c = makeContract(1000000);
  assert.equal(c.total_required_minor, 100000000);
  assert.equal(c.paid_minor, 0);
  assert.equal(c.remaining_minor, 100000000);
  assert.equal(c.status, 'unpaid');

  assert.throws(() => makeContract(500000), /already exists/);
  assert.throws(
    () => createContract({ contract_number: 'R-9', project_id: project.id, customer_id: customer.id, total_required: 0 }, user),
    /total required/i
  );
  assert.throws(
    () => createContract({ contract_number: 'R-10', project_id: project.id, customer_id: 999, total_required: 100 }, user),
    /customer/i
  );
});

test('Phase7: multiple payments calculate total paid and remaining automatically', () => {
  const c = makeContract(1000000); // 1,000,000 IQD
  const cash = account(db, 'CASH');

  const p1 = addPayment({ contract_id: c.id, amount: 300000, biz_date: '2026-09-28' }, user, '127.0.0.1');
  assert.equal(p1.contract.paid_minor, 30000000);
  assert.equal(p1.contract.remaining_minor, 70000000);
  assert.equal(p1.contract.status, 'partially_paid');
  assert.match(p1.payment.payment_number, /^RON-\d{4}-\d{6}$/);

  const p2 = addPayment({ contract_id: c.id, amount: 250000, biz_date: '2026-09-30' }, user, '127.0.0.1');
  // 300,000 + 250,000 = 550,000 paid, remaining 450,000 — the spec example
  assert.equal(p2.contract.paid_minor, 55000000);
  assert.equal(p2.contract.remaining_minor, 45000000);

  const detail = getContract(c.id);
  assert.equal(detail.paid_minor, 55000000);
  assert.equal(detail.remaining_minor, 45000000);
  assert.equal(detail.payments.length, 2);
  assert.equal(detail.payment_count, 2);

  // money actually landed in cash
  assert.equal(accountBalance(cash.id, 'IQD'), 55000000);
  // and is linked to real transactions (single ledger path, no double counting)
  assert.ok(detail.payments.every((p) => p.tx_number));

  // overpayment blocked
  assert.throws(() => addPayment({ contract_id: c.id, amount: 600000 }, user), /exceeds the remaining balance/);

  // wrong currency blocked
  assert.throws(() => addPayment({ contract_id: c.id, amount: 100, currency: 'USD' }, user), /same currency/);

  // negative / zero blocked
  assert.throws(() => addPayment({ contract_id: c.id, amount: 0 }, user), /payment amount/i);
  assert.throws(() => addPayment({ contract_id: c.id, amount: -500 }, user), /payment amount/i);

  // audit trail for payments
  const log = listAudit({ action: 'CREATE_PAYMENT' });
  assert.equal(log.total, 2);
});

test('Phase7: status transitions unpaid -> partially -> paid, and overdue by due date', () => {
  const c = createContract(
    { contract_number: 'R-2000', project_id: project.id, customer_id: customer.id,
      total_required: 100000, currency: 'IQD', due_date: '2026-01-01' },
    user
  );
  assert.equal(getContract(c.id).status, 'overdue', 'unpaid past due date = overdue');

  addPayment({ contract_id: c.id, amount: 50000 }, user);
  assert.equal(getContract(c.id).status, 'overdue');

  addPayment({ contract_id: c.id, amount: 50000 }, user);
  assert.equal(getContract(c.id).status, 'paid', 'fully paid wins over overdue');

  // lowering total below what was paid is blocked
  assert.throws(() => updateContract(c.id, { total_required: 10000 }, user), /already paid/);
});

test('Phase7: list + search by contract, name, phone, house unit', () => {
  const c = makeContract(1000000);
  createContract(
    { contract_number: 'R-3000', project_id: project.id, customer_id: customer.id, house_unit: 'H-77',
      total_required: 500000, currency: 'IQD' },
    user
  );
  assert.equal(listContracts({}).total, 2);
  assert.equal(listContracts({ q: 'R-1042' }).total, 1);
  assert.equal(listContracts({ q: 'Ahmed' }).total, 2);
  assert.equal(listContracts({ q: 'H-77' }).total, 1);
  assert.equal(listContracts({ q: '07501234567' }).total, 2);
  assert.equal(listContracts({ status: 'unpaid' }).rows.length, 2);
  void c;
});

test('Phase7: special Ronaki report — totals, statuses, per-customer history', () => {
  const c1 = makeContract(1000000);
  createContract(
    { contract_number: 'R-7777', project_id: project.id, customer_id: customer.id,
      total_required: 200000, currency: 'IQD' },
    user
  );
  addPayment({ contract_id: c1.id, amount: 1000000 }, user); // fully paid
  const c2 = getContract('R-7777');
  addPayment({ contract_id: c2.id, amount: 50000 }, user); // partial

  const report = ronakiReport({});
  assert.equal(report.summary.total_customers, 2);
  assert.equal(report.summary.by_status.paid, 1);
  assert.equal(report.summary.by_status.partially_paid, 1);
  assert.equal(report.summary.by_status.unpaid, 0);

  const totals = report.summary.totals.find((t) => t.currency === 'IQD');
  assert.equal(totals.total_required_minor, 120000000);
  assert.equal(totals.paid_minor, 105000000);
  assert.equal(totals.remaining_minor, 15000000);

  assert.equal(report.payments.length, 2);
  assert.ok(report.payments.every((p) => p.customer_name === 'Ahmed Ali'));

  // date filtering of payments
  const filtered = ronakiReport({ from: '2000-01-01', to: '2000-12-31' });
  assert.equal(filtered.payments.length, 0);
});

test('Phase7: payment receipt shows remaining balance and can be reprinted', () => {
  const c = makeContract(1000000);
  const p1 = addPayment({ contract_id: c.id, amount: 400000 }, user);

  const receipt = createReceiptForTransaction(p1.transaction_id, user);
  assert.match(receipt.receipt_number, /^PRZ-\d{4}-\d{6}$/);
  const snap = receipt.snapshot;
  assert.equal(snap.customer.name, 'Ahmed Ali');
  assert.equal(snap.transaction.amount_minor, 40000000);
  assert.ok(snap.remaining_balance.length === 1);
  assert.equal(snap.remaining_balance[0].remaining_minor, 60000000);
  assert.ok(snap.processed_by);

  // reprints bump the counter, never create duplicate receipt numbers
  const again = reprintReceipt(receipt.id);
  assert.equal(again.print_count, receipt.print_count + 1);
  assert.equal(again.receipt_number, receipt.receipt_number);
  const third = reprintReceipt(receipt.receipt_number); // reprint by number too
  assert.equal(third.print_count, receipt.print_count + 2);

  // duplicate receipt creation returns existing (silent duplicate guard)
  const dup = createReceiptForTransaction(p1.transaction_id, user, null, { silentDuplicate: true });
  assert.equal(dup.id, receipt.id);
});
