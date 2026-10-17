/**
 * Backup & restore — JSON snapshots of every data table, stored inside the database.
 *
 * Safety rules:
 *   - a backup is a full export of the data tables (no local files: the host has no disk)
 *   - restore ALWAYS creates a safety snapshot of the current data first
 *   - restore requires an explicit confirmation string (no accidental clicks)
 *   - the restore is one atomic batch: if anything fails, nothing is changed
 *   - the restore action itself is audited
 */
import { all, batch, one, run, transaction } from '../db/index.js';
import { config } from '../config.js';
import { audit } from './audit.js';
import { setSetting, getSetting } from './settings.js';
import { badRequest, notFound, validationError } from '../lib/errors.js';
import { nowIso } from '../lib/dates.js';

const EXPORT_FORMAT = 'parez-export';
const EXPORT_VERSION = 2;

// Never exported or overwritten by a restore: the backup catalogue itself and
// migration bookkeeping.
const SKIP_TABLES = new Set(['schema_migrations', 'backups', 'backup_snapshots']);

function fileNameNow(prefix) {
  return `${prefix}-${nowIso().replace(/[:.]/g, '-')}.json`;
}

async function dataTables() {
  const rows = await all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return rows.map((r) => r.name).filter((n) => !SKIP_TABLES.has(n));
}

/**
 * Parents before children, so inserts never reference a missing row.
 * Uses the foreign keys each table declares.
 */
async function insertOrder(tables) {
  const parents = new Map();
  for (const t of tables) {
    const fks = await all(`PRAGMA foreign_key_list('${t}')`);
    parents.set(t, fks.map((f) => f.table).filter((p) => tables.includes(p) && p !== t));
  }
  const ordered = [];
  const visiting = new Set();
  const visit = (t) => {
    if (ordered.includes(t)) return;
    if (visiting.has(t)) return; // cycle: keep declaration order for this pair
    visiting.add(t);
    for (const p of parents.get(t) || []) visit(p);
    visiting.delete(t);
    ordered.push(t);
  };
  for (const t of tables) visit(t);
  return ordered;
}

async function exportTables() {
  const out = {};
  for (const t of await dataTables()) {
    out[t] = await all(`SELECT * FROM "${t}"`);
  }
  return out;
}

export async function listBackups() {
  const rows = await all(
    `SELECT b.*, (s.file_name IS NOT NULL) AS has_file
     FROM backups b LEFT JOIN backup_snapshots s ON s.file_name = b.file_name
     ORDER BY b.id DESC LIMIT 100`
  );
  const files = rows.map((r) => ({ ...r, exists: !!r.has_file, has_file: undefined }));
  const lastAt = await getSetting('backup.last_at', '');
  const warnDays = Number(await getSetting('backup.warn_days', String(config.backupWarnDays)));
  const needsBackup = !lastAt || (Date.now() - new Date(lastAt).getTime()) / 86_400_000 >= warnDays;
  return {
    backups: files,
    last_backup_at: lastAt,
    warn_days: warnDays,
    needs_backup: needsBackup,
    backup_dir: 'stored in the database',
  };
}

export async function createBackup(note, user, ip) {
  const file_name = fileNameNow('parez-backup');
  const created_at = nowIso();
  const tables = await exportTables();
  const text = JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, file_name, created_at, tables });
  const size = Buffer.byteLength(text, 'utf8');

  const id = await transaction(async () => {
    await run('INSERT INTO backup_snapshots (file_name, created_at, payload) VALUES (?,?,?)', file_name, created_at, text);
    const r = await run(
      'INSERT INTO backups (file_name, size_bytes, note, created_by) VALUES (?,?,?,?)',
      file_name,
      size,
      note || null,
      user ? user.id : null
    );
    if (user) {
      await audit({ user, action: 'BACKUP', entity: 'backup', entityId: file_name, newValue: { size_bytes: size }, reason: note || null, ip });
    }
    return Number(r.lastInsertRowid);
  });
  await setSetting('backup.last_at', created_at, user, ip, { audited: false });
  return { id, file_name, size_bytes: size, created_at };
}

/** The stored backup for a catalogue id: the catalogue row and the JSON text. */
export async function backupFilePath(id) {
  const row = await one('SELECT * FROM backups WHERE id = ?', Number(id));
  if (!row) throw notFound('Backup');
  const snap = await one('SELECT payload FROM backup_snapshots WHERE file_name = ?', row.file_name);
  if (!snap) throw notFound('Backup file');
  return { row, text: snap.payload };
}

/**
 * Restore a backup. `confirm` must exactly equal the backup's file name.
 * Replaces all data in one atomic batch; the previous data is kept as a
 * safety snapshot first.
 */
export async function restoreBackup(id, { confirm }, user, ip) {
  const { row, text } = await backupFilePath(id);
  if (confirm !== row.file_name) {
    throw validationError(`Confirmation mismatch. Type the backup file name exactly: ${row.file_name}`);
  }

  // 1) validate the backup before touching anything
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw badRequest('BACKUP_INVALID', 'This backup cannot be restored (unreadable). Nothing was changed.');
  }
  const tables = payload?.tables;
  if (payload?.format !== EXPORT_FORMAT || !tables || typeof tables !== 'object') {
    throw badRequest('BACKUP_INVALID', 'This backup cannot be restored (unknown format). Nothing was changed.');
  }
  if (!Array.isArray(tables.users) || tables.users.length === 0) {
    throw badRequest('BACKUP_INVALID', 'This backup contains no users. Nothing was changed.');
  }

  // 2) safety snapshot of the CURRENT data first
  const safety = await createBackup('Automatic safety copy before restore', user, ip);

  // 3) one atomic batch: clear current data, then insert the backup's rows
  const current = await dataTables();
  const restored = Object.keys(tables).filter((t) => current.includes(t));
  const order = await insertOrder(restored);
  // Some tables reference each other (e.g. transactions <-> receipts), so foreign
  // keys are checked once at commit instead of per statement. The batch is atomic.
  const statements = [{ sql: 'PRAGMA defer_foreign_keys = ON', args: [] }];
  for (const t of (await insertOrder(current)).reverse()) statements.push({ sql: `DELETE FROM "${t}"`, args: [] });
  for (const t of order) {
    for (const rowData of tables[t]) {
      const cols = Object.keys(rowData);
      if (cols.length === 0) continue;
      statements.push({
        sql: `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args: cols.map((c) => (rowData[c] === undefined ? null : rowData[c])),
      });
    }
  }
  await batch(statements);

  // 4) audit the restore inside the restored data
  await transaction(() =>
    audit({
      user,
      action: 'RESTORE',
      entity: 'backup',
      entityId: row.file_name,
      newValue: { safety_copy: safety.file_name, restored_at: nowIso() },
      reason: 'Database restored from backup',
      ip,
    })
  );
  return { restored: row.file_name, safety_copy: safety.file_name };
}
