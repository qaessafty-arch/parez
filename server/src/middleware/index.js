/** Request middleware: session resolution, RBAC, CSRF, rate limits, errors. */
import { config } from '../config.js';
import { userFromToken, can } from '../services/auth.js';
import { AppError, unauthorized, forbidden, dbUnavailable } from '../lib/errors.js';

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${config.cookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Attach req.user when a valid session cookie is present. */
export function sessionMiddleware(req, res, next) {
  const token = parseCookies(req)[config.cookieName];
  req.sessionToken = token || null;
  try {
    req.user = userFromToken(token) || null;
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, permission)) return next(forbidden(`Missing permission: ${permission}`));
    next();
  };
}

/**
 * CSRF: browsers cannot attach custom headers on cross-site form posts.
 * All mutating API requests must send `X-Requested-With: parez`.
 */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) {
    const h = req.headers['x-requested-with'];
    if (h !== 'parez') return next(new AppError(403, 'CSRF_BLOCKED', 'Request blocked (missing security header)'));
  }
  next();
}

/** Security headers (no framework dependency). */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Powered-By', 'Parez');
  next();
}

/** Central error handler — never leaks stack traces to clients in production. */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request body' } });
  }
  if (String(err?.message || '').includes('SQLITE_CONSTRAINT')) {
    console.error('[db constraint]', err.message);
    return res.status(409).json({
      error: { code: 'DB_CONSTRAINT', message: 'The record conflicts with existing data (possible duplicate).' },
    });
  }
  if (String(err?.message || '').includes('SQLITE') && String(err?.message || '').includes('unable to open')) {
    return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: dbUnavailable().message } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Something went wrong. The operation was not completed.' },
  });
}
