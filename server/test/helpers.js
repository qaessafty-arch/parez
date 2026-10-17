/** Test helpers: isolated database per test file, seeded master data, factories. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, setClient, migrate, one, run, transaction } from '../src/db/index.js';
import { seedMaster } from '../src/db/seed.js';
import { mustToMinor } from '../src/lib/money.js';

let counter = 0;

/**
 * A fresh, migrated, seeded database on a temporary file. A file (not :memory:)
 * because each transaction opens its own connection.
 */
export async function freshDb() {
  counter++;
  const file = path.join(os.tmpdir(), `parez-test-${process.pid}-${counter}.db`);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  setClient(openDatabase(`file:${file}`));
  await migrate();
  await seedMaster();
}

export async function makeUser({ username = 'admin', roleCode = 'admin', fullName = 'Test Admin' } = {}) {
  const role = await one('SELECT id, permissions FROM roles WHERE code = ?', roleCode);
  const scrypt = fakeHash();
  const r = await run(`INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)`, role.id, username, fullName, scrypt);
  return {
    id: Number(r.lastInsertRowid),
    username,
    full_name: fullName,
    role_id: role.id,
    permissions: JSON.parse(role.permissions || '[]'),
  };
}

/** Deterministic placeholder hash for factory users (not used for login in tests that bypass auth). */
function fakeHash() {
  return 'scrypt$1$1$1$dGVzdA$dGVzdA';
}

export async function makeCustomer(name = 'Ahmed Ali', phone = '07501234567') {
  const n = (await one('SELECT COUNT(*) AS c FROM customers')).c + 1;
  const y = new Date().getUTCFullYear();
  const r = await run(`INSERT INTO customers (code, full_name, phone, created_by) VALUES (?,?,?,1)`, `CUS-${y}-${String(n).padStart(6, '0')}`, name, phone);
  return one('SELECT * FROM customers WHERE id = ?', Number(r.lastInsertRowid));
}

export function svc(code) {
  return one('SELECT * FROM services WHERE code = ?', code);
}
export function typeOf(code) {
  return one('SELECT * FROM transaction_types WHERE code = ?', code);
}
export function account(code) {
  return one('SELECT * FROM accounts WHERE code = ?', code);
}
export { mustToMinor, transaction };
