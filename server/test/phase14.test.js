/** Phase 14 — backup, restore, safety copies (snapshots stored in the database). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { one, run } from '../src/db/index.js';
import { hashPassword } from '../src/services/auth.js';
import { createCustomer } from '../src/services/customers.js';
import { listBackups, createBackup, restoreBackup, backupFilePath } from '../src/services/backup.js';
import { can } from '../src/services/auth.js';
import { freshDb } from './helpers.js';

let boss;
let emp;

before(async () => {
  await freshDb();
  const roleAdmin = await one(`SELECT id, permissions FROM roles WHERE code='admin'`);
  const roleEmp = await one(`SELECT id, permissions FROM roles WHERE code='employee'`);
  await run('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)', roleAdmin.id, 'owner', 'Shop Owner', hashPassword('owner-pass-1'));
  await run('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)', roleEmp.id, 'clerk', 'Shop Clerk', hashPassword('clerk-pass-1'));
  boss = { id: 1, username: 'owner', full_name: 'Shop Owner', permissions: ['*'] };
  emp = { id: 2, username: 'clerk', full_name: 'Shop Clerk', permissions: JSON.parse(roleEmp.permissions) };
});

test('Phase14: backup stores a full snapshot and records metadata + warning state', async () => {
  // create a customer so the backup has content
  await createCustomer({ full_name: 'Backup Client', phone: '07501112222' }, boss);
  const beforeInfo = await listBackups();
  assert.equal(beforeInfo.last_backup_at, '');
  assert.equal(beforeInfo.needs_backup, true, 'no backup yet => warning shown');

  const b = await createBackup('first backup', boss, '127.0.0.1');
  assert.match(b.file_name, /^parez-backup-.*\.json$/);
  assert.ok(b.size_bytes > 0);

  const info = await listBackups();
  assert.equal(info.backups.length, 1);
  assert.ok(info.last_backup_at);
  assert.equal(info.needs_backup, false);
  assert.ok(info.backups[0].exists, 'snapshot must be stored and listed as available');

  const { row, text } = await backupFilePath(b.id);
  assert.equal(row.file_name, b.file_name);
  const payload = JSON.parse(text);
  assert.equal(payload.format, 'parez-export');
  assert.ok(payload.tables.customers.some((c) => c.full_name === 'Backup Client'), 'snapshot contains the customer');
  assert.ok(!('backups' in payload.tables), 'backup catalogue is not part of the export');

  // permission check: employee cannot manage backups
  assert.equal(can(emp, 'backup.manage'), false);
  assert.equal(can(boss, 'backup.manage'), true);
});

test('Phase14: restore requires exact confirmation and rewinds data safely', async () => {
  const backupId = (await one('SELECT id FROM backups ORDER BY id LIMIT 1')).id;

  // wrong confirmation => validation error, nothing changes
  await assert.rejects(() => restoreBackup(backupId, { confirm: 'yes' }, boss, '127.0.0.1'), /Confirmation mismatch/i);
  assert.equal((await one('SELECT COUNT(*) AS c FROM customers')).c, 1);

  // data AFTER the backup that must disappear after restore
  await createCustomer({ full_name: 'After Backup Client', phone: '07503334444' }, boss);
  assert.equal((await one('SELECT COUNT(*) AS c FROM customers')).c, 2);

  const { row } = await backupFilePath(backupId);
  const result = await restoreBackup(backupId, { confirm: row.file_name }, boss, '127.0.0.1');
  assert.equal(result.restored, row.file_name);
  assert.ok(result.safety_copy);

  // data rewound to the moment of the backup
  assert.equal((await one('SELECT COUNT(*) AS c FROM customers')).c, 1);
  assert.equal((await one(`SELECT COUNT(*) AS c FROM customers WHERE full_name='After Backup Client'`)).c, 0);

  // safety copy of the pre-restore state was written and catalogued
  const info = await listBackups();
  assert.ok(info.backups.some((b) => b.file_name === result.safety_copy));
  const safety = await backupFilePath(info.backups.find((b) => b.file_name === result.safety_copy).id);
  assert.ok(
    JSON.parse(safety.text).tables.customers.some((c) => c.full_name === 'After Backup Client'),
    'safety copy preserves the pre-restore data'
  );

  // the restore itself is audited
  const auditCount = (await one(`SELECT COUNT(*) AS c FROM audit_logs WHERE action='RESTORE'`)).c;
  assert.ok(auditCount >= 1, 'restore must be audited');

  // the restored database is fully usable
  const c = await createCustomer({ full_name: 'Post Restore Client', phone: '07505556666' }, boss);
  assert.ok(c.id);
});

test('Phase14: backup of the restored DB still works and the database passes an integrity check', async () => {
  const b2 = await createBackup('second backup', boss, '127.0.0.1');
  const { text } = await backupFilePath(b2.id);
  assert.equal(JSON.parse(text).format, 'parez-export');
  assert.equal((await one('PRAGMA integrity_check')).integrity_check, 'ok');
});

test('Phase14 sanity: restored database remains fully migrated and usable', async () => {
  assert.ok((await one('SELECT COUNT(*) AS c FROM roles')).c >= 2, 'roles present after restore');
  assert.ok((await one('SELECT COUNT(*) AS c FROM users')).c >= 2, 'users present after restore');
  assert.equal((await one(`SELECT COUNT(*) AS c FROM users WHERE username='owner'`)).c, 1);
});
