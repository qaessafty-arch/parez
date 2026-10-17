/** Phase 8-13 — cash management, expenses, daily closing, reports, search, audit, permissions. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, account } from './helpers.js';
import { createCustomer } from '../src/services/customers.js';
import { createTransaction, updateTransaction } from '../src/services/transactions.js';
import {
  recordExpense, listExpenses, updateExpense, listExpenseCategories, createExpenseCategory,
} from '../src/services/expenses.js';
import { cashSnapshot, cashMovements } from '../src/services/cash.js';
import { closingPreview, closeDay, reopenDay, closingHistory } from '../src/services/closing.js';
import { runReport, toCsv } from '../src/services/reports.js';
import { globalSearch } from '../src/services/search.js';
import { listAudit } from '../src/services/audit.js';
import { can } from '../src/services/auth.js';
import { createContract, addPayment } from '../src/services/ronaki.js';
import { createReceiptForTransaction } from '../src/services/receipts.js';
import { one } from '../src/db/index.js';

let db;
let user;
let admin;
const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

beforeEach(async () => {
  await freshDb();
  user = await makeUser({ username: 'clerk', roleCode: 'employee', fullName: 'Shop Clerk' });
  admin = await makeUser({ username: 'boss', roleCode: 'admin', fullName: 'Shop Boss' });
});

test('Phase8: expense recording posts cash out and keeps category detail', async () => {
  const cat = (await listExpenseCategories()).find((c) => c.code === 'electricity');
  const { expense, transaction: txn } = await recordExpense(
    { category_id: cat.id, description: 'Electricity bill', amount: 45000, currency: 'IQD', supplier: 'Korek', receipt_no: 'R-991' },
    user,
    '127.0.0.1'
  );
  assert.match(expense.expense_number, /^EXP-\d{4}-\d{6}$/);
  assert.equal(txn.amount_minor, 4500000);
  assert.equal(txn.direction, 'out');
  assert.equal(txn.commission_minor, 0);

  const snapshot = await cashSnapshot(TODAY);
  const iqd = snapshot.rows.find((r) => r.currency === 'IQD');
  assert.equal(iqd.cash_out_minor, 4500000);
  assert.equal(iqd.opening_minor, 0);
  assert.equal(iqd.expected_minor, -4500000);

  const list = await listExpenses({});
  assert.equal(list.total, 1);
  assert.equal(list.totals.find((t) => t.currency === 'IQD').total_minor, 4500000);

  await assert.rejects(() => recordExpense({ category_id: 999, description: 'Valid desc', amount: 100 }, user), /category/i);
  await assert.rejects(() => recordExpense({ category_id: cat.id, description: '', amount: 100 }, user), /description/i);
  await assert.rejects(() => recordExpense({ category_id: cat.id, description: 'Valid desc', amount: 0 }, user), /amount/i);
});

test('Phase8: expense money changes require a reason and are audited', async () => {
  const cat = (await listExpenseCategories())[0];
  const { expense } = await recordExpense({ category_id: cat.id, description: 'Office supplies', amount: 10000 }, user);
  await assert.rejects(() => updateExpense(expense.id, { amount: 20000 }, user), /reason/i);

  await updateExpense(expense.id, { amount: 20000, reason: 'Wrong amount entered' }, admin, '127.0.0.1');
  const after = await listExpenses({});
  assert.equal(after.rows[0].amount_minor, 2000000);
  const log = await listAudit({ action: 'EDIT_EXPENSE' });
  assert.ok(log.total >= 1);
  assert.ok(log.rows.some((r) => String(r.reason || '').includes('Wrong amount')));
  // the underlying transaction edit is audited too (old -> new)
  const txLog = await listAudit({ action: 'EDIT_TRANSACTION' });
  assert.ok(txLog.total >= 1);
});

test('Phase8: custom expense categories can be added', async () => {
  const created = await createExpenseCategory({ name: 'Tea & Guests' }, admin);
  assert.ok(created.id);
  assert.equal(created.is_system, 0);
  await assert.rejects(() => createExpenseCategory({ name: 'Tea & Guests' }, admin), /already exists/);
});

test('Phase8: cash movements list shows who did what', async () => {
  const cash = await account('CASH');
  await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 90000, currency: 'IQD',
      commission: 0, description: 'Counter sale' },
    user
  );
  const movements = await cashMovements({ from: TODAY, to: TODAY });
  assert.equal(movements.total, 1);
  assert.equal(movements.rows[0].direction, 'in');
  assert.equal(movements.rows[0].created_by_name, 'Shop Clerk');
  assert.equal(movements.rows[0].description, 'Counter sale');
});

test('Phase8: daily closing computes expected cash and difference', async () => {
  const cash = await account('CASH');
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 500000, currency: 'IQD', commission: 0 }, user);
  await createTransaction({ service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 300000, currency: 'IQD', commission: 0 }, user);
  const cat = (await listExpenseCategories())[0];
  await recordExpense({ category_id: cat.id, description: 'Transport', amount: 45000 }, user);

  // expected = 500,000 + 300,000 - 45,000 = 755,000 IQD
  const preview = await closingPreview(TODAY);
  const iqd = preview.cash.find((r) => r.currency === 'IQD');
  assert.equal(iqd.opening_minor, 0);
  assert.equal(iqd.cash_in_minor, 80000000);
  assert.equal(iqd.cash_out_minor, 4500000);
  assert.equal(iqd.expected_minor, 75500000);
  assert.equal(preview.closed, null);

  await assert.rejects(() => closeDay({ date: TODAY, actual: {} }, admin), /actual cash/i);

  const result = await closeDay({ date: TODAY, actual: { IQD: 750000 }, note: 'End of day' }, admin, '127.0.0.1');
  assert.equal(result.closings.length, 1);
  assert.equal(result.closings[0].difference_minor, -500000, '750,000 counted vs 755,000 expected = -5,000');
  assert.equal(result.closings[0].expected_cash_minor, 75500000);
  assert.equal(result.closings[0].actual_cash_minor, 75000000);
  assert.equal(result.closings[0].closed_by, admin.id);

  await assert.rejects(() => closeDay({ date: TODAY, actual: { IQD: 750000 } }, admin), /already closed/i);

  const history = await closingHistory({});
  assert.equal(history.total, 1);
  assert.equal(history.days[0].date, TODAY);
  assert.equal((await listAudit({ action: 'DAILY_CLOSING' })).total, 1);
});

test('Phase8: closed days are locked — no backdated creates/edits until reopened', async () => {
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 100000, currency: 'IQD', commission: 0 },
    user
  );
  await closeDay({ date: TODAY, actual: { IQD: 100000 } }, admin);

  await assert.rejects(async () => await createTransaction(
      { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 5000, currency: 'IQD', commission: 0, biz_date: TODAY },
      user
    ),
    /closed day/i
  );
  await assert.rejects(() => updateTransaction(t.id, { amount_minor: 12000000, reason: 'correction' }, user), /closed day/i);

  // future-dated activity is fine (the day after TODAY)
  const tomorrow = (() => {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  assert.ok((await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 5000, currency: 'IQD', commission: 0, biz_date: tomorrow },
    user
  )).id);

  // employees cannot reopen days (route-level permission) — service still demands a reason
  assert.equal(can(user, 'closing.reopen'), false);
  await assert.rejects(() => reopenDay({ date: TODAY, reason: '' }, admin), /reason/i);

  await reopenDay({ date: TODAY, reason: 'Counted cash again' }, admin, '127.0.0.1');
  assert.equal((await closingHistory({})).total, 0);
  const auditLog = await listAudit({ action: 'DAILY_CLOSING_REOPEN' });
  assert.equal(auditLog.total, 1);
  assert.ok(auditLog.rows[0].old_value, 'original closing preserved inside the audit log');

  // after reopen the day can be corrected
  const updated = await updateTransaction(t.id, { amount_minor: 9000000, reason: 'Correction after reopen' }, admin);
  assert.equal(updated.amount_minor, 9000000);
});

test('Phase8: reports — commission, expense, cash flow, customer debt, CSV export', async () => {
  const cash = await account('CASH');
  const customer = await createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  await createTransaction(
    { service_code: 'fastpay', type_code: 'withdrawal', customer_id: customer.id,
      account_id: (await account('FASTPAY')).id, amount: 250000, currency: 'IQD', commission: 2500 },
    user
  );
  await createTransaction(
    { service_code: 'other', type_code: 'cash_in', account_id: cash.id, amount: 80000, currency: 'IQD', commission: 0 },
    user
  );
  const cat = (await listExpenseCategories())[0];
  await recordExpense({ category_id: cat.id, description: 'Rent', amount: 100000 }, user);
  await createTransaction(
    { service_code: 'other', type_code: 'credit_sale', customer_id: customer.id, account_id: cash.id,
      amount: 120000, currency: 'IQD', commission: 0 },
    user
  );

  const commission = await runReport('commission', { from: '2000-01-01', to: '2099-12-31' });
  assert.equal(commission.rows.length, 1);
  assert.equal(commission.totals.find((t) => t.currency === 'IQD').commission, '2,500');

  const expenses = await runReport('expense', { from: '2000-01-01', to: '2099-12-31' });
  assert.equal(expenses.rows.length, 1);
  assert.equal(expenses.totals[0].total, '100,000');

  const cashFlow = await runReport('cash_flow', { from: '2000-01-01', to: '2099-12-31' });
  assert.ok(cashFlow.rows.length >= 1);
  const last = cashFlow.rows[cashFlow.rows.length - 1];
  assert.equal(last.cash_in, '80,000');
  assert.equal(last.cash_out, '100,000');

  const debt = await runReport('customer_debt', {});
  assert.equal(debt.rows.length, 1);
  assert.equal(debt.rows[0].outstanding, '120,000');

  const txns = await runReport('transactions', { from: '2000-01-01', to: '2099-12-31' });
  assert.ok(txns.rows.length >= 3);
  const fastpay = await runReport('fastpay', { from: '2000-01-01', to: '2099-12-31' });
  assert.equal(fastpay.rows.length, 1);
  assert.equal(fastpay.totals.find((t) => t.currency === 'IQD').commission, '2,500');

  const csv = toCsv(commission);
  assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM for Excel');
  assert.ok(csv.includes('Commission Report'));
  assert.ok(csv.includes('2,500 IQD'), 'commission value formatted with currency in CSV cell');
});

test('Phase8: global search finds customers, transactions, contracts and receipts', async () => {
  const customer = await createCustomer({ full_name: 'Ahmed Ali', phone: '07501234567' }, user);
  const cash = await account('CASH');
  const t = await createTransaction(
    { service_code: 'other', type_code: 'customer_payment', customer_id: customer.id, account_id: cash.id,
      amount: 50000, currency: 'IQD', commission: 0, reference_no: 'INV-555' },
    user
  );
  const contract = await createContract(
    { contract_number: 'R-8899', project_id: (await one('SELECT id FROM ronaki_projects LIMIT 1')).id,
      customer_id: customer.id, total_required: 100000, currency: 'IQD' },
    user
  );
  await addPayment({ contract_id: contract.id, amount: 10000 }, user);
  const receipt = await createReceiptForTransaction(t.id, user);

  assert.ok((await globalSearch('Ahmed')).results.some((r) => r.kind === 'customer'));
  assert.ok((await globalSearch('07501234567')).results.some((r) => r.kind === 'customer'));
  assert.ok((await globalSearch(t.tx_number)).results.some((r) => r.kind === 'transaction'));
  assert.ok((await globalSearch('INV-555')).results.some((r) => r.kind === 'transaction'));
  assert.ok((await globalSearch('R-8899')).results.some((r) => r.kind === 'ronaki_contract'));
  assert.ok((await globalSearch(receipt.receipt_number)).results.some((r) => r.kind === 'receipt'));
  assert.ok((await globalSearch('zzz-nothing')).results.length === 0);
});

test('Phase9-19: permission matrix enforced for employee vs admin', async () => {
  const employee = await makeUser({ username: 'emp2', roleCode: 'employee' });
  const boss = await makeUser({ username: 'boss2', roleCode: 'admin' });

  assert.ok(can(employee, 'transaction.create'));
  assert.ok(can(employee, 'customer.create'));
  assert.ok(can(employee, 'report.view'));
  assert.ok(can(employee, 'receipt.print'));
  assert.ok(can(employee, 'closing.view'));
  assert.ok(can(employee, 'ronaki.payment'));

  assert.ok(!can(employee, 'transaction.reverse'));
  assert.ok(!can(employee, 'transaction.edit'));
  assert.ok(!can(employee, 'transaction.cancel'));
  assert.ok(!can(employee, 'user.manage'));
  assert.ok(!can(employee, 'settings.manage'));
  assert.ok(!can(employee, 'backup.manage'));
  assert.ok(!can(employee, 'audit.view'));
  assert.ok(!can(employee, 'closing.perform'));
  assert.ok(!can(employee, 'closing.reopen'));
  assert.ok(!can(employee, 'expense.edit'));

  for (const p of ['transaction.reverse', 'transaction.edit', 'user.manage', 'settings.manage',
    'backup.manage', 'audit.view', 'closing.perform', 'closing.reopen', 'expense.edit', 'ronaki.edit']) {
    assert.ok(can(boss, p), `admin must have ${p}`);
  }
});
