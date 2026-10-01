/** Phase 14 — backup, restore, safety copies (file-backed DB in a temp dir). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Point the app at a throw-away file database BEFORE importing app modules.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parez-backup-test-'));
process.env.PAREZ_DB_PATH = path.join(tmpRoot, 'parez.db');
process.env.PAREZ_DATA_DIR = tmpRoot;

const { getDb, closeDb, setDb, openDatabase, migrate, transaction } = await import('../src/db/index.js');
const { seedMaster } = await import('../src/db/seed.js');
const { hashPassword, login, logout, userFromToken } = await import('../src/services/auth.js');
const { createCustomer } = await import('../src/services/customers.js');
const { createTransaction } = await import('../src/services/transactions.js');
const { listBackups, createBackup, restoreBackup, backupFilePath } = await import('../src/services/backup.js');
const { can } = await import('../src/services/auth.js');
const { freshDb } = await import('./helpers.js');

let boss;
let emp;

before(() => {
  getDb();
  seedMaster();
  const db = getDb();
  const roleAdmin = db.prepare(`SELECT id, permissions FROM roles WHERE code='admin'`).get();
  const roleEmp = db.prepare(`SELECT id, permissions FROM roles WHERE code='employee'`).get();
  db.prepare('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)')
    .run(roleAdmin.id, 'owner', 'Shop Owner', hashPassword('owner-pass-1'));
  db.prepare('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)')
    .run(roleEmp.id, 'clerk', 'Shop Clerk', hashPassword('clerk-pass-1'));
  boss = { id: 1, username: 'owner', full_name: 'Shop Owner', permissions: ['*'] };
  emp = { id: 2, username: 'clerk', full_name: 'Shop Clerk', permissions: JSON.parse(roleEmp.permissions) };
});

after(() => {
  try { closeDb(); } catch { /* ignore */ }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('Phase14: backup creates a real file and records metadata + warning state', () => {
  // create a customer so the backup has content
  createCustomer({ full_name: 'Backup Client', phone: '07501112222' }, boss);
  const beforeInfo = listBackups();
  assert.equal(beforeInfo.last_backup_at, '');
  assert.equal(beforeInfo.needs_backup, true, 'no backup yet => warning shown');

  const b = createBackup('first backup', boss, '127.0.0.1');
  assert.match(b.file_name, /^parez-backup-.*\.db$/);
  const filePath = path.join(tmpRoot, 'backups', b.file_name);
  assert.ok(fs.existsSync(filePath), 'backup file must exist on disk');
  assert.ok(fs.statSync(filePath).size > 0);

  const info = listBackups();
  assert.equal(info.backups.length, 1);
  assert.ok(info.last_backup_at);
  assert.equal(info.needs_backup, false);
  assert.ok(info.backups[0].exists);

  const { row, path: p } = backupFilePath(b.id);
  assert.equal(row.file_name, b.file_name);
  assert.equal(p, filePath);

  // permission check: employee cannot manage backups
  assert.equal(can(emp, 'backup.manage'), false);
  assert.equal(can(boss, 'backup.manage'), true);
});

test('Phase14: restore requires exact confirmation and rewinds data safely', () => {
  const db = getDb();
  const backupId = db.prepare('SELECT id FROM backups ORDER BY id LIMIT 1').get().id;

  // wrong confirmation => validation error, nothing changes
  assert.throws(() => restoreBackup(backupId, { confirm: 'yes' }, boss, '127.0.0.1'), /Confirmation mismatch/i);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM customers').get().c, 1);

  // data AFTER the backup that must disappear after restore
  createCustomer({ full_name: 'After Backup Client', phone: '07503334444' }, boss);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM customers').get().c, 2);

  const { row } = backupFilePath(backupId);
  const result = restoreBackup(backupId, { confirm: row.file_name }, boss, '127.0.0.1');
  assert.equal(result.restored, row.file_name);
  assert.ok(result.safety_copy);

  // data rewound to the moment of the backup
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM customers').get().c, 1);
  assert.equal(getDb().prepare(`SELECT COUNT(*) AS c FROM customers WHERE full_name='After Backup Client'`).get().c, 0);

  // safety copy of the pre-restore state was written and catalogued
  const info = listBackups();
  assert.ok(info.backups.some((b) => b.file_name === result.safety_copy));
  const safetyFile = path.join(tmpRoot, 'backups', result.safety_copy);
  assert.ok(fs.existsSync(safetyFile));
  const safetyProbe = openDatabase(safetyFile);
  assert.equal(
    safetyProbe.prepare(`SELECT COUNT(*) AS c FROM customers WHERE full_name='After Backup Client'`).get().c,
    1,
    'safety copy preserves the pre-restore data'
  );
  safetyProbe.close();

  // the restore itself is audited inside the restored DB
  const auditCount = getDb().prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action='RESTORE'`).get().c;
  assert.ok(auditCount >= 1, 'restore must be audited');

  // the restored DB is fully usable
  const c = createCustomer({ full_name: 'Post Restore Client', phone: '07505556666' }, boss);
  assert.ok(c.id);
});

test('Phase14: backup of the restored DB still works (WAL integrity)', () => {
  const b2 = createBackup('second backup', boss, '127.0.0.1');
  assert.ok(fs.existsSync(path.join(tmpRoot, 'backups', b2.file_name)));
  const probe = openDatabase(path.join(tmpRoot, 'backups', b2.file_name));
  assert.equal(probe.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  probe.close();
});

test('Phase14 sanity: restored database remains fully migrated and usable', () => {
  const db = getDb();
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM roles').get().c >= 2, 'roles present after restore');
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM users').get().c >= 2, 'users present after restore');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE username='owner'`).get().c, 1);
  void migrate;
  void transaction;
  void logout;
  void userFromToken;
  void login;
  void freshDb;
});
