/**
 * Auth — scrypt password hashing, DB-backed sessions, role-based permissions.
 * Passwords are never stored or logged in plain text.
 */
import crypto from 'node:crypto';
import { getDb, transaction } from '../db/index.js';
import { config } from '../config.js';
import { nowIso } from '../lib/dates.js';
import { unauthorized, forbidden, conflict, badRequest, validationError, notFound, AppError } from '../lib/errors.js';
import { audit } from './audit.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw validationError('Password must be at least 6 characters');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function permissionsOf(role) {
  try {
    const list = JSON.parse(role.permissions || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function can(user, permission) {
  if (!user) return false;
  const perms = user.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}

function publicUser(row, role) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role_code: role.code,
    role_name: role.name,
    permissions: permissionsOf(role),
    is_active: !!row.is_active,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

/** Login rate limiting: track failed attempts per identifier. */
function assertNotLocked(db, identifier, ip) {
  const windowStart = new Date(Date.now() - config.loginLockMinutes * 60_000).toISOString();
  const failures = db
    .prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE identifier IN (?,?) AND success = 0 AND created_at >= ?')
    .get(identifier, ip, windowStart).c;
  if (failures >= config.maxLoginAttempts) {
    throw new AppError(429, 'LOGIN_LOCKED', `Too many failed attempts. Try again in ${config.loginLockMinutes} minutes.`);
  }
}

export function setupNeeded() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  return count === 0;
}

export function login({ username, password }, ctx = {}) {
  const db = getDb();
  const ip = ctx.ip || null;
  const identifier = String(username || '').trim();
  assertNotLocked(db, identifier, ip);

  const fail = () => {
    db.prepare('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 0, ?)').run(identifier, nowIso());
    db.prepare('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 0, ?)').run(ip || identifier, nowIso());
    throw unauthorized('Invalid username or password');
  };

  const row = db
    .prepare(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? COLLATE NOCASE`
    )
    .get(identifier);
  if (!row || !row.is_active) fail();
  if (!verifyPassword(password, row.password_hash)) fail();

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)'
  ).run(sha256(token), row.id, expiresAt, ip, (ctx.userAgent || '').slice(0, 300));
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
  db.prepare('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 1, ?)').run(identifier, nowIso());

  const role = { code: row.role_code, name: row.role_name, permissions: row.role_permissions };
  const user = publicUser(row, role);
  transaction((conn) => audit(conn, { user, action: 'LOGIN', entity: 'user', entityId: user.id, ip }));
  return { token, user, expiresAt };
}

export function logout(token) {
  if (!token) return;
  const db = getDb();
  const sess = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!sess) return;
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), sess.id);
  const user = getUserById(sess.user_id);
  if (user) {
    transaction((conn) => audit(conn, { user, action: 'LOGOUT', entity: 'user', entityId: user.id }));
  }
}

/** Resolve a session token to a full user object, or null. */
export function userFromToken(token) {
  if (!token) return null;
  const db = getDb();
  const sess = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .get(sha256(token), nowIso());
  if (!sess) return null;
  const row = db
    .prepare(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(sess.user_id);
  if (!row || !row.is_active) return null;
  return publicUser(row, { code: row.role_code, name: row.role_name, permissions: row.role_permissions });
}

export function getUserById(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(id);
  if (!row) return null;
  return publicUser(row, { code: row.role_code, name: row.role_name, permissions: row.role_permissions });
}

// ---------------- Users management (admin) ----------------

export function listUsers() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.last_login_at, u.created_at,
              r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`
    )
    .all();
  const roles = db.prepare('SELECT id, code, name, permissions FROM roles ORDER BY id').all();
  // expose permissions as a parsed array so every consumer gets the same shape as publicUser()
  const roleList = roles.map(({ permissions, ...rest }) => ({ ...rest, permissions: permissionsOf({ permissions }) }));
  const permissionsByRole = Object.fromEntries(roleList.map((r) => [r.code, r.permissions]));
  return { users: rows.map((r) => ({ ...r, is_active: !!r.is_active, permissions: permissionsByRole[r.role_code] || [] })), roles: roleList };
}

export function createUser({ username, full_name, password, role_code }, actor, ip) {
  const db = getDb();
  const uname = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(uname)) throw validationError('Username must be 3-32 letters/numbers/._-');
  if (!full_name || String(full_name).trim().length < 2) throw validationError('Please enter the full name');
  const role = db.prepare('SELECT * FROM roles WHERE code = ?').get(role_code);
  if (!role) throw badRequest('INVALID_ROLE', 'Unknown role');
  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
  if (exists) throw conflict('USERNAME_TAKEN', 'That username is already in use');
  const hash = hashPassword(password);
  const result = transaction((conn) => {
    const r = conn
      .prepare('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)')
      .run(role.id, uname, String(full_name).trim(), hash);
    const id = Number(r.lastInsertRowid);
    audit(conn, { user: actor, action: 'USER_CREATED', entity: 'user', entityId: id, newValue: { username: uname, role: role_code }, ip });
    return id;
  });
  return getUserById(result);
}

export function updateUser(id, { full_name, role_code, is_active, password }, actor, ip) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw notFound('User');
  if (actor.id === id && is_active === false) throw forbidden('You cannot deactivate your own account');
  const role = role_code ? db.prepare('SELECT * FROM roles WHERE code = ?').get(role_code) : null;
  if (role_code && !role) throw badRequest('INVALID_ROLE', 'Unknown role');
  const changes = {};
  transaction((conn) => {
    if (full_name) {
      conn.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?').run(String(full_name).trim(), nowIso(), id);
      changes.full_name = [row.full_name, full_name];
    }
    if (role_code) {
      conn.prepare('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?').run(role.id, nowIso(), id);
      changes.role = [row.role_id, role.id];
    }
    if (typeof is_active === 'boolean') {
      if (actor.id === id && !is_active) throw forbidden('You cannot deactivate your own account');
      conn.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(is_active ? 1 : 0, nowIso(), id);
      changes.is_active = [!!row.is_active, is_active];
    }
    if (password) {
      conn.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(password), nowIso(), id);
      changes.password = ['***', '***'];
      conn.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), id);
      audit(conn, { user: actor, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: id, ip });
    }
    audit(conn, { user: actor, action: 'USER_UPDATED', entity: 'user', entityId: id, newValue: changes, ip });
  });
  return getUserById(id);
}

export function changeOwnPassword({ current_password, new_password }, actor, ip, currentToken = null) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(actor.id);
  if (!row || !verifyPassword(current_password, row.password_hash)) {
    throw unauthorized('Current password is incorrect');
  }
  transaction((conn) => {
    conn.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(new_password), nowIso(), actor.id);
    // Revoke every other session for this user (never trust old tokens after a password change).
    if (currentToken) {
      const keep = sha256(currentToken);
      conn
        .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?')
        .run(nowIso(), actor.id, keep);
    } else {
      conn.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), actor.id);
    }
    audit(conn, { user: actor, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: actor.id, ip });
  });
  return { ok: true };
}
