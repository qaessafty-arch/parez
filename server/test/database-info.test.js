/** Settings → database info: counts rows and never exposes the token. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { one, run } from '../src/db/index.js';
import { hashPassword } from '../src/services/auth.js';
import { databaseInfo } from '../src/services/settings.js';
import { createCustomer } from '../src/services/customers.js';
import { freshDb } from './helpers.js';

let boss;

before(async () => {
  await freshDb();
  const role = await one(`SELECT id FROM roles WHERE code='admin'`);
  await run('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)', role.id, 'owner', 'Shop Owner', hashPassword('owner-pass-1'));
  boss = { id: 1, username: 'owner', full_name: 'Shop Owner', permissions: ['*'] };
});

test('databaseInfo: reports the database kind and row counts', async () => {
  const empty = await databaseInfo();
  assert.equal(empty.customers, 0);
  assert.equal(empty.transactions, 0);
  assert.ok(['local', 'turso'].includes(empty.kind));

  await createCustomer({ full_name: 'Count Me', phone: '07500000001' }, boss);
  const after = await databaseInfo();
  assert.equal(after.customers, 1);
});

test('databaseInfo: never includes a token or password', async () => {
  const info = await databaseInfo();
  assert.ok(!JSON.stringify(info).toLowerCase().includes('token'));
  assert.ok(!('authToken' in info));
});
