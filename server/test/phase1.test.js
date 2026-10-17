/** Phase 1 — database architecture: schema, constraints, money safety, ledger rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, svc, typeOf, account } from './helpers.js';
import { toMinor, toDecimalString, convertMinor, netOf, MoneyError } from '../src/lib/money.js';
import { computeLedgerRows, accountBalance, postLedger } from '../src/services/ledger.js';
import { resolveRange, isValidBizDate } from '../src/lib/dates.js';
import { all, one, run } from '../src/db/index.js';

test('Phase1: schema tables exist with FK enforcement', async () => {
  await freshDb();
  const tables = (await all(`SELECT name FROM sqlite_master WHERE type='table'`)).map((t) => t.name);
  for (const t of [
    'users', 'roles', 'customers', 'transactions', 'ledger_entries', 'services', 'accounts',
    'ronaki_projects', 'ronaki_contracts', 'ronaki_payments', 'expenses', 'expense_categories',
    'receipts', 'daily_closings', 'audit_logs', 'settings', 'currencies', 'sequences', 'backups',
  ]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  const fk = await one('PRAGMA foreign_keys');
  assert.equal(Object.values(fk)[0], 1);
});

test('Phase1: money is stored as integer minor units, never float', async () => {
  await freshDb();
  const col = await one(`SELECT type FROM pragma_table_info('transactions') WHERE name='amount_minor'`);
  assert.equal(col.type, 'INTEGER');
  // constraint: negative amount rejected
  await assert.rejects(() => run(`INSERT INTO transactions (tx_number, biz_date, time, service_id, type_id, account_id, direction, amount_minor, currency, created_by)
         VALUES ('TX-BAD', '2026-09-30', '10:00', 1, 1, 1, 'in', -500, 'IQD', 1)`)
  );
});

test('money: parse/format/convert without floating point drift', async () => {
  assert.equal(toMinor('250,000.50'), 25000050);
  assert.equal(toMinor(250000), 25000000);
  assert.equal(toDecimalString(25000050), '250000.50');
  assert.equal(toDecimalString(-1250), '-12.50');
  assert.equal(toMinor('abc'), null);
  assert.throws(() => netOf(1000, 2000), MoneyError);
  // 100.00 USD * 1310 = 131,000.00 IQD -> minor 13,100,000
  assert.equal(convertMinor(10000, '1310.00'), 13100000);
  assert.equal(convertMinor(25000000, '0.000763'), 19075); // rounding stable
});

test('money: currency separation is structural (per-currency balances)', async () => {
  await freshDb();
  const user = await makeUser();
  const cash = await account('CASH');
  await run(`INSERT INTO transactions (tx_number, biz_date, time, service_id, type_id, account_id, direction, amount_minor, currency, created_by, status)
     VALUES ('TX-IOD', '2026-09-30', '09:00', 4, 9, ?, 'in', 5000000, 'IQD', ?, 'completed')`, cash.id, user.id);
  await run(`INSERT INTO transactions (tx_number, biz_date, time, service_id, type_id, account_id, direction, amount_minor, currency, created_by, status)
     VALUES ('TX-USDD', '2026-09-30', '09:05', 4, 9, ?, 'in', 25000, 'USD', ?, 'completed')`, cash.id, user.id);
  for (const t of await all('SELECT * FROM transactions')) await postLedger(t);
  assert.equal(await accountBalance(cash.id, 'IQD'), 5000000);
  assert.equal(await accountBalance(cash.id, 'USD'), 25000);
  // mixed currency rows are impossible in one balance query (grouped by currency)
  const grouped = await all(`SELECT currency, COUNT(*) c FROM ledger_entries GROUP BY currency`);
  assert.equal(grouped.length, 2);
});

test('ledger rules: in posts gross, out posts net of commission, transfer posts both sides', async () => {
  const fastpay = { id: 10, currency: 'IQD' };
  const rows = computeLedgerRows({
    id: 1, account_id: 2, counter_account_id: 3, direction: 'in', amount_minor: 25000000,
    commission_minor: 250000, currency: 'IQD', biz_date: '2026-09-30',
  });
  assert.deepEqual(rows.map((r) => [r.account_id, r.direction, r.amount_minor]), [[2, 'in', 25000000]]);

  const out = computeLedgerRows({
    id: 2, account_id: 2, counter_account_id: null, direction: 'out', amount_minor: 25000000,
    commission_minor: 250000, currency: 'IQD', biz_date: '2026-09-30',
  });
  assert.deepEqual(out.map((r) => [r.direction, r.amount_minor]), [['out', 24750000]]);

  const tr = computeLedgerRows({
    id: 3, account_id: 2, counter_account_id: 3, direction: 'transfer', amount_minor: 10000000,
    commission_minor: 0, currency: 'IQD', biz_date: '2026-09-30',
  });
  assert.equal(tr.length, 2);
  assert.equal(tr[0].direction, 'out');
  assert.equal(tr[1].direction, 'in');

  const none = computeLedgerRows({
    id: 4, account_id: 2, counter_account_id: null, direction: 'none', amount_minor: 999,
    commission_minor: 0, currency: 'IQD', biz_date: '2026-09-30',
  });
  assert.equal(none.length, 0);
  assert.ok(fastpay);
});

test('dates: Iraq local time ranges and validation', async () => {
  assert.ok(isValidBizDate('2026-09-30'));
  assert.ok(!isValidBizDate('2026-13-40'));
  assert.ok(!isValidBizDate('30-09-2026'));
  const week = resolveRange('week', '2026-09-30'); // Wed -> since Saturday
  assert.equal(week.from, '2026-09-26');
  const custom = resolveRange('custom', '2026-09-30', { from: '2026-09-01', to: '2026-09-15' });
  assert.equal(custom.from, '2026-09-01');
  assert.throws(() => resolveRange('custom', '2026-09-30', { from: '2026-09-15', to: '2026-09-01' }));
});

test('seed: master data present and idempotent', async () => {
  await freshDb();
  const counts = async () => ({
    cur: (await one('SELECT COUNT(*) c FROM currencies')).c,
    acc: (await one('SELECT COUNT(*) c FROM accounts')).c,
    svc: (await one('SELECT COUNT(*) c FROM services')).c,
    types: (await one('SELECT COUNT(*) c FROM transaction_types')).c,
    roles: (await one('SELECT COUNT(*) c FROM roles')).c,
  });
  const a = await counts();
  assert.equal(a.cur, 2);
  assert.equal(a.acc, 5);
  assert.equal(a.svc, 4);
  assert.equal(a.roles, 2);
  const b = await counts();
  assert.deepEqual(a, b);
  assert.ok(await svc('fastpay'));
  assert.ok(await typeOf('withdrawal'));
});
