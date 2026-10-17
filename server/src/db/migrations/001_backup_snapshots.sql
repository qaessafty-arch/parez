-- Backups are stored as JSON snapshots inside the database itself, because the
-- production host (Vercel) has no writable disk to keep .db files on.
CREATE TABLE IF NOT EXISTS backup_snapshots (
  file_name  TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payload    TEXT NOT NULL
);
