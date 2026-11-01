/** Dealer inventory: first-run listing, buy, sell, adjust, and guard rails. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { one, run } from '../src/db/index.js';
import { hashPassword } from '../src/services/auth.js';
import {
  listInventory, recordPurchase, recordSale, recordAdjustment, getMovements, getInventoryByAccountCode,
} from '../src/services/dealers.js';
import { freshDb } from './helpers.js';

let user;

before(async () => {
  await freshDb();
  const role = await one(`SELECT id FROM roles WHERE code='admin'`);
  await run('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)', role.id, 'owner', 'Shop Owner', hashPassword('owner-pass-1'));
  user = { id: 1, username: 'owner', full_name: 'Shop Owner', permissions: ['*'] };
});

test('dealers: every dealer account is listed with zeros before any stock', async () => {
  const rows = await listInventory();
  const codes = rows.map((r) => r.account_code).sort();
  assert.ok(codes.includes('FASTPAY') && codes.includes('FIB') && codes.includes('CARDHOUSE'));
  for (const r of rows) {
    assert.equal(r.current_qty, 0);
    assert.equal(r.profit_minor, 0);
  }
});

test('dealers: buy then sell updates stock, revenue and profit', async () => {
  const buy = await recordPurchase({ accountCode: 'FASTPAY', currency: 'IQD', qty: 10, unitCostMinor: 150000, user, ip: '127.0.0.1' });
  assert.equal(buy.inventory.current_qty, 10);
  assert.equal(buy.inventory.wholesale_cost_minor, 1500000);

  const sell = await recordSale({ accountCode: 'FASTPAY', currency: 'IQD', qty: 4, unitPriceMinor: 200000, user, ip: '127.0.0.1' });
  assert.equal(sell.inventory.current_qty, 6);
  assert.equal(sell.inventory.retail_revenue_minor, 800000);
  assert.equal(sell.inventory.profit_minor, 200000, '4 x (2000.00 - 1500.00)');

  const listed = (await listInventory()).find((r) => r.account_code === 'FASTPAY' && r.currency === 'IQD');
  assert.equal(listed.current_qty, 6);
});

test('dealers: cannot sell more than is in stock', async () => {
  await assert.rejects(
    () => recordSale({ accountCode: 'FASTPAY', currency: 'IQD', qty: 999, unitPriceMinor: 100, user, ip: '127.0.0.1' }),
    /Insufficient stock/i
  );
});

test('dealers: an adjustment cannot make stock negative, and a valid one is logged', async () => {
  await assert.rejects(
    () => recordAdjustment({ accountCode: 'FASTPAY', currency: 'IQD', qtyChange: -100, user, ip: '127.0.0.1' }),
    /negative/i
  );
  const adj = await recordAdjustment({ accountCode: 'FASTPAY', currency: 'IQD', qtyChange: -1, unitPriceMinor: 0, notes: 'damaged', user, ip: '127.0.0.1' });
  assert.equal(adj.inventory.current_qty, 5);

  const inv = await getInventoryByAccountCode('FASTPAY', 'IQD');
  const moves = await getMovements(inv.id);
  assert.equal(moves.total, 3, 'purchase, sale and adjustment are all recorded');
});
