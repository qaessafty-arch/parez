/**
 * Dev-only routes — diagnostics and maintenance helpers.
 *
 * The whole router is refused unless the server booted with
 * PAREZ_DEV_ACCOUNT=1 *and* NODE_ENV=development. A production build
 * (npm start) never registers it, so these endpoints do not exist for
 * the client at all — this is the check, not hidden UI.
 */
import os from 'node:os';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { requirePermission } from '../middleware/index.js';

export const devRouter = Router();

devRouter.use((req, res, next) => {
  if (!config.devAccount.enabled) return next(); // falls through to 404
  requirePermission('settings.manage')(req, res, next);
});

devRouter.get('/info', (req, res) => {
  const db = getDb();
  const count = (t) => {
    try {
      return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    } catch {
      return null;
    }
  };
  res.json({
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    db_path: config.dbPath,
    backup_dir: config.backupDir,
    session_ttl_hours: config.sessionTtlHours,
    counts: {
      users: count('users'),
      customers: count('customers'),
      transactions: count('transactions'),
      ledger_entries: count('ledger_entries'),
      expenses: count('expenses'),
      ronaki_contracts: count('ronaki_contracts'),
      receipts: count('receipts'),
      audit_logs: count('audit_logs'),
    },
  });
});

/**
 * Referential-integrity check. Reports rows that point at a user that no
 * longer exists — the one real hazard when accounts are deleted.
 */
devRouter.get('/orphans', (req, res) => {
  const db = getDb();
  const checks = [
    ['transactions', 'created_by'],
    ['customers', 'created_by'],
    ['receipts', 'created_by'],
    ['ronaki_contracts', 'created_by'],
    ['ronaki_payments', 'created_by'],
    ['daily_closings', 'closed_by'],
  ];
  const orphans = [];
  for (const [table, col] of checks) {
    try {
      const n = db
        .prepare(
          `SELECT COUNT(*) AS c FROM ${table} t
           LEFT JOIN users u ON u.id = t.${col}
           WHERE t.${col} IS NOT NULL AND u.id IS NULL`
        )
        .get().c;
      if (n > 0) orphans.push({ table, column: col, count: n });
    } catch {
      /* table not present in this schema */
    }
  }
  res.json({ ok: orphans.length === 0, orphans });
});

export default devRouter;
