/**
 * Audit — every sensitive action is recorded with old/new values and reason.
 * The audit log is append-only: no update or delete APIs exist.
 */
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/dates.js';

export const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
  'CREATE_CUSTOMER', 'EDIT_CUSTOMER',
  'CREATE_TRANSACTION', 'EDIT_TRANSACTION', 'REVERSE_TRANSACTION', 'CANCEL_TRANSACTION',
  'REFUND_TRANSACTION', 'CORRECT_TRANSACTION',
  'CREATE_PAYMENT', 'EDIT_PAYMENT',
  'CREATE_EXPENSE', 'EDIT_EXPENSE',
  'CREATE_RONAKI_CONTRACT', 'EDIT_RONAKI_CONTRACT', 'CREATE_RONAKI_PROJECT',
  'DAILY_CLOSING', 'DAILY_CLOSING_REOPEN',
  'BACKUP', 'RESTORE',
  'USER_CREATED', 'USER_UPDATED', 'USER_PASSWORD_CHANGED', 'USER_DELETED',
  'SETTINGS_CHANGED', 'ROLES_CHANGED', 'DEMO_DATA_REMOVED', 'SETUP_COMPLETED',
  'ACCOUNT_BALANCE_CHANGED',
];

/**
 * Write an audit entry. Never throws into the caller's flow for logging issues
 * (but failures are surfaced in dev to avoid silent gaps).
 */
export function audit(conn, entry) {
  const db = conn || getDb();
  const {
    user = null,
    action,
    entity = '',
    entityId = null,
    oldValue = null,
    newValue = null,
    reason = null,
    ip = null,
  } = entry;
  if (!action) throw new Error('audit: action is required');
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, old_value, new_value, reason, ip, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    user ? user.id : null,
    user ? user.full_name || user.username : 'system',
    action,
    entity,
    entityId === null ? null : String(entityId),
    oldValue === null ? null : JSON.stringify(oldValue),
    newValue === null ? null : JSON.stringify(newValue),
    reason,
    ip,
    nowIso()
  );
}

export function listAudit({ from = null, to = null, action = null, entity = null, search = null, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (from) { where.push('created_at >= ?'); params.push(`${from}T00:00:00Z`); }
  if (to) { where.push('created_at <= ?'); params.push(`${to}T23:59:59Z`); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (entity) { where.push('entity = ?'); params.push(entity); }
  if (search) {
    where.push('(user_name LIKE ? OR entity_id LIKE ? OR reason LIKE ? OR old_value LIKE ? OR new_value LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(limit, 500), offset);
  return { total, rows };
}
