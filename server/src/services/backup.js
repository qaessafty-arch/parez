/**
 * Backup & restore — consistent SQLite snapshots with confirmation-gated restore.
 *
 * Safety rules:
 *   - backups are created with VACUUM INTO (consistent, non-destructive)
 *   - restore ALWAYS writes a pre-restore safety copy first
 *   - restore requires an explicit confirmation string (no accidental clicks)
 *   - the restore action itself is audited into the restored database
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, closeDb, openDatabase, migrate, setDb } from '../db/index.js';
import { seedMaster } from '../db/seed.js';
import { audit } from './audit.js';
import { setSetting, getSetting } from './settings.js';
import { badRequest, notFound, validationError } from '../lib/errors.js';
import { nowIso } from '../lib/dates.js';
import { transaction } from '../db/index.js';

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 23);
}

/** File name with millisecond stamp + collision loop (restore can rewind the catalog while files remain). */
function uniqueFileName(prefix) {
  const dir = config.backupDir;
  let name = `${prefix}-${stamp()}.db`;
  let n = 1;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${prefix}-${stamp()}-${n++}.db`;
  }
  return name;
}

export function listBackups() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 100').all();
  const files = rows
    .map((r) => {
      const p = path.join(config.backupDir, r.file_name);
      const exists = fs.existsSync(p);
      return { ...r, exists, size_bytes: exists ? fs.statSync(p).size : r.size_bytes };
    });
  const lastAt = getSetting('backup.last_at', '');
  const warnDays = Number(getSetting('backup.warn_days', String(config.backupWarnDays)));
  const needsBackup = !lastAt || (Date.now() - new Date(lastAt).getTime()) / 86_400_000 >= warnDays;
  return {
    backups: files,
    last_backup_at: lastAt,
    warn_days: warnDays,
    needs_backup: needsBackup,
    backup_dir: config.backupDir,
  };
}

export function createBackup(note, user, ip) {
  const db = getDb();
  const file_name = uniqueFileName('parez-backup');
  const target = path.join(config.backupDir, file_name);
  try {
    // VACUUM INTO writes a consistent snapshot of the live DB without blocking reads.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (e) {
    throw badRequest('BACKUP_FAILED', `Backup failed: ${e.message}. Your data was not modified.`);
  }
  const size = fs.statSync(target).size;
  const id = transaction((conn) => {
    const r = conn
      .prepare('INSERT INTO backups (file_name, size_bytes, note, created_by) VALUES (?,?,?,?)')
      .run(file_name, size, note || null, user ? user.id : null);
    return Number(r.lastInsertRowid);
  });
  setSetting('backup.last_at', nowIso(), user, ip, { audited: false });
  if (user) {
    transaction((conn) =>
      audit(conn, { user, action: 'BACKUP', entity: 'backup', entityId: file_name, newValue: { size_bytes: size }, reason: note || null, ip })
    );
  }
  return { id, file_name, size_bytes: size, created_at: nowIso() };
}

export function backupFilePath(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(Number(id));
  if (!row) throw notFound('Backup');
  const p = path.join(config.backupDir, row.file_name);
  if (!fs.existsSync(p)) throw notFound('Backup file');
  return { row, path: p };
}

/**
 * Restore a backup. Returns only after the live DB is swapped and reopened.
 * `confirm` must exactly equal the file name — an explicit, deliberate action.
 */
export function restoreBackup(id, { confirm }, user, ip) {
  const { row, path: backupPath } = backupFilePath(id);
  if (confirm !== row.file_name) {
    throw validationError(`Confirmation mismatch. Type the backup file name exactly: ${row.file_name}`);
  }

  // 1) integrity check of the backup before touching anything
  let probe;
  try {
    probe = openDatabase(backupPath);
    const check = probe.prepare('PRAGMA integrity_check').get();
    const firstVal = Object.values(check)[0];
    if (firstVal !== 'ok') throw new Error(`integrity_check: ${firstVal}`);
    const hasUsers = probe.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
    if (hasUsers === 0) throw new Error('backup contains no users');
    probe.close();
  } catch (e) {
    try { probe?.close(); } catch { /* ignore */ }
    throw badRequest('BACKUP_INVALID', `This backup cannot be restored (${e.message}). Nothing was changed.`);
  }

  // 2) safety copy of the CURRENT database first
  const safetyName = uniqueFileName('parez-pre-restore');
  const safetyPath = path.join(config.backupDir, safetyName);
  const live = config.dbPath;
  try {
    getDb().exec(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}'`);
  } catch (e) {
    throw badRequest('SAFETY_COPY_FAILED', `Could not create a pre-restore safety copy: ${e.message}. Restore aborted.`);
  }
  const safetySize = fs.statSync(safetyPath).size;

  // 3) swap the database file
  closeDb();
  for (const suffix of ['-wal', '-shm']) {
    const p = `${live}${suffix}`;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
  try {
    fs.copyFileSync(backupPath, live);
  } catch (e) {
    // put the safety copy back if the swap failed
    try { fs.copyFileSync(safetyPath, live); } catch { /* ignore */ }
    setDb(openDatabase(live));
    throw badRequest('RESTORE_FAILED', `Restore failed: ${e.message}. Your previous data was put back.`);
  }

  // 4) reopen, migrate to current schema, seed master data, audit inside restored DB
  const conn = openDatabase(live);
  migrate(conn);
  setDb(conn);
  seedMaster(conn);
  // catalogue the safety copy inside the RESTORED db (the pre-restore row was rewound away)
  transaction((c) =>
    c.prepare('INSERT INTO backups (file_name, size_bytes, note, created_by) VALUES (?,?,?,?)')
      .run(safetyName, safetySize, 'Automatic safety copy before restore', user ? user.id : null)
  );
  transaction((c) =>
    audit(c, {
      user,
      action: 'RESTORE',
      entity: 'backup',
      entityId: row.file_name,
      newValue: { safety_copy: safetyName, restored_at: nowIso() },
      reason: 'Database restored from backup',
      ip,
    })
  );
  return { restored: row.file_name, safety_copy: safetyName };
}
