/**
 * Auth — scrypt password hashing, DB-backed sessions, role-based permissions.
 * Passwords are never stored or logged in plain text.
 */
import crypto from 'node:crypto';
import { all, one, run, transaction } from '../db/index.js';
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
async function assertNotLocked(identifier, ip) {
  const windowStart = new Date(Date.now() - config.loginLockMinutes * 60_000).toISOString();
  const failures = (
    await one(
      'SELECT COUNT(*) AS c FROM login_attempts WHERE identifier IN (?,?) AND success = 0 AND created_at >= ?',
      identifier,
      ip,
      windowStart
    )
  ).c;
  if (failures >= config.maxLoginAttempts) {
    throw new AppError(429, 'LOGIN_LOCKED', `Too many failed attempts. Try again in ${config.loginLockMinutes} minutes.`);
  }
}

export async function setupNeeded() {
  const count = (await one('SELECT COUNT(*) AS c FROM users')).c;
  return count === 0;
}

export async function login({ username, password }, ctx = {}) {
  const ip = ctx.ip || null;
  const identifier = String(username || '').trim();
  await assertNotLocked(identifier, ip);

  const fail = async () => {
    await run('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 0, ?)', identifier, nowIso());
    await run('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 0, ?)', ip || identifier, nowIso());
    throw unauthorized('Invalid username or password');
  };

  const row = await one(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? COLLATE NOCASE`,
    identifier
  );
  if (!row || !row.is_active) await fail();
  if (!verifyPassword(password, row.password_hash)) await fail();

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000).toISOString();
  await run(
    'INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)',
    sha256(token),
    row.id,
    expiresAt,
    ip,
    (ctx.userAgent || '').slice(0, 300)
  );
  await run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), row.id);
  await run('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?, 1, ?)', identifier, nowIso());

  const role = { code: row.role_code, name: row.role_name, permissions: row.role_permissions };
  const user = publicUser(row, role);
  await transaction(() => audit({ user, action: 'LOGIN', entity: 'user', entityId: user.id, ip }));
  return { token, user, expiresAt };
}

export async function logout(token) {
  if (!token) return;
  const sess = await one('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!sess) return;
  await run('UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso(), sess.id);
  const user = await getUserById(sess.user_id);
  if (user) {
    await transaction(() => audit({ user, action: 'LOGOUT', entity: 'user', entityId: user.id }));
  }
}

/** Resolve a session token to a full user object, or null. */
export async function userFromToken(token) {
  if (!token) return null;
  const sess = await one(
    'SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
    sha256(token),
    nowIso()
  );
  if (!sess) return null;
  const row = await one(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    sess.user_id
  );
  if (!row || !row.is_active) return null;
  return publicUser(row, { code: row.role_code, name: row.role_name, permissions: row.role_permissions });
}

export async function getUserById(id) {
  const row = await one(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    id
  );
  if (!row) return null;
  return publicUser(row, { code: row.role_code, name: row.role_name, permissions: row.role_permissions });
}

// ---------------- Users management (admin) ----------------

export async function listUsers() {
  const rows = await all(
    `SELECT u.id, u.username, u.full_name, u.is_active, u.last_login_at, u.created_at,
            r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`
  );
  const roles = await all('SELECT id, code, name, permissions FROM roles ORDER BY id');
  // expose permissions as a parsed array so every consumer gets the same shape as publicUser()
  const roleList = roles.map(({ permissions, ...rest }) => ({ ...rest, permissions: permissionsOf({ permissions }) }));
  const permissionsByRole = Object.fromEntries(roleList.map((r) => [r.code, r.permissions]));
  return { users: rows.map((r) => ({ ...r, is_active: !!r.is_active, permissions: permissionsByRole[r.role_code] || [] })), roles: roleList };
}

export async function createUser({ username, full_name, password, role_code }, actor, ip) {
  const uname = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(uname)) throw validationError('Username must be 3-32 letters/numbers/._-');
  if (!full_name || String(full_name).trim().length < 2) throw validationError('Please enter the full name');
  const role = await one('SELECT * FROM roles WHERE code = ?', role_code);
  if (!role) throw badRequest('INVALID_ROLE', 'Unknown role');
  const exists = await one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', uname);
  if (exists) throw conflict('USERNAME_TAKEN', 'That username is already in use');
  const hash = hashPassword(password);
  const id = await transaction(async () => {
    const r = await run(
      'INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)',
      role.id,
      uname,
      String(full_name).trim(),
      hash
    );
    const newId = Number(r.lastInsertRowid);
    await audit({ user: actor, action: 'USER_CREATED', entity: 'user', entityId: newId, newValue: { username: uname, role: role_code }, ip });
    return newId;
  });
  return getUserById(id);
}

export async function updateUser(id, { full_name, role_code, is_active, password }, actor, ip) {
  const row = await one('SELECT * FROM users WHERE id = ?', id);
  if (!row) throw notFound('User');
  if (actor.id === id && is_active === false) throw forbidden('You cannot deactivate your own account');
  const role = role_code ? await one('SELECT * FROM roles WHERE code = ?', role_code) : null;
  if (role_code && !role) throw badRequest('INVALID_ROLE', 'Unknown role');
  const changes = {};
  await transaction(async () => {
    if (full_name) {
      await run('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?', String(full_name).trim(), nowIso(), id);
      changes.full_name = [row.full_name, full_name];
    }
    if (role_code) {
      await run('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?', role.id, nowIso(), id);
      changes.role = [row.role_id, role.id];
    }
    if (typeof is_active === 'boolean') {
      if (actor.id === id && !is_active) throw forbidden('You cannot deactivate your own account');
      await run('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', is_active ? 1 : 0, nowIso(), id);
      changes.is_active = [!!row.is_active, is_active];
    }
    if (password) {
      await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), nowIso(), id);
      changes.password = ['***', '***'];
      await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), id);
      await audit({ user: actor, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: id, ip });
    }
    await audit({ user: actor, action: 'USER_UPDATED', entity: 'user', entityId: id, newValue: changes, ip });
  });
  return getUserById(id);
}

export async function changeOwnPassword({ current_password, new_password }, actor, ip, currentToken = null) {
  const row = await one('SELECT * FROM users WHERE id = ?', actor.id);
  if (!row || !verifyPassword(current_password, row.password_hash)) {
    throw unauthorized('Current password is incorrect');
  }
  await transaction(async () => {
    await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(new_password), nowIso(), actor.id);
    // Revoke every other session for this user (never trust old tokens after a password change).
    if (currentToken) {
      const keep = sha256(currentToken);
      await run(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?',
        nowIso(),
        actor.id,
        keep
      );
    } else {
      await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), actor.id);
    }
    await audit({ user: actor, action: 'USER_PASSWORD_CHANGED', entity: 'user', entityId: actor.id, ip });
  });
  return { ok: true };
}
