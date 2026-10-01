/** Test helpers: isolated in-memory DB per test file, seeded master data, factories. */
import { openDatabase, migrate, setDb, transaction } from '../src/db/index.js';
import { seedMaster } from '../src/db/seed.js';
import { mustToMinor } from '../src/lib/money.js';

let counter = 0;

export function freshDb() {
  const conn = openDatabase(':memory:');
  counter++;
  migrate(conn);
  setDb(conn);
  seedMaster(conn);
  return conn;
}

export function makeUser(db, { username = 'admin', roleCode = 'admin', fullName = 'Test Admin' } = {}) {
  const role = db.prepare('SELECT id, permissions FROM roles WHERE code = ?').get(roleCode);
  const scrypt = fakeHash();
  const r = db
    .prepare(`INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)`)
    .run(role.id, username, fullName, scrypt);
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

export function makeCustomer(db, name = 'Ahmed Ali', phone = '07501234567') {
  const n = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c + 1;
  const y = new Date().getUTCFullYear();
  const r = db
    .prepare(`INSERT INTO customers (code, full_name, phone, created_by) VALUES (?,?,?,1)`)
    .run(`CUS-${y}-${String(n).padStart(6, '0')}`, name, phone);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function svc(db, code) {
  return db.prepare('SELECT * FROM services WHERE code = ?').get(code);
}
export function typeOf(db, code) {
  return db.prepare('SELECT * FROM transaction_types WHERE code = ?').get(code);
}
export function account(db, code) {
  return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
}
export { mustToMinor, transaction };
