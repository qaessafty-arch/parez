/** Audit log filters: by user name and by entity. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { audit, listAudit } from '../src/services/audit.js';
import { freshDb } from './helpers.js';

before(async () => {
  await freshDb();
  await audit({ user: { id: 1, username: 'owner', full_name: 'Shop Owner' }, action: 'CREATE_CUSTOMER', entity: 'customers', entityId: 7 });
  await audit({ user: { id: 2, username: 'clerk', full_name: 'Shop Clerk' }, action: 'CREATE_TRANSACTION', entity: 'transactions', entityId: 9 });
});

test('audit: filter by user name matches part of the name', async () => {
  const r = await listAudit({ user: 'clerk' });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].user_name, 'Shop Clerk');
});

test('audit: filter by entity returns only that entity', async () => {
  const r = await listAudit({ entity: 'customers' });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].entity, 'customers');
});

test('audit: no filters returns every entry, newest first', async () => {
  const r = await listAudit({});
  assert.equal(r.total, 2);
  assert.equal(r.rows[0].action, 'CREATE_TRANSACTION');
});
