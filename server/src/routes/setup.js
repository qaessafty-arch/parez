/** First-run setup: creates shop settings + initial admin account. */
import { Router } from 'express';
import { getDb, transaction } from '../db/index.js';
import { seedMaster } from '../db/seed.js';
import { setupNeeded, hashPassword } from '../services/auth.js';
import { audit } from '../services/audit.js';
import { parse, z } from '../lib/validate.js';
import { conflict, validationError, badRequest } from '../lib/errors.js';
import { config } from '../config.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ needsSetup: setupNeeded() });
});

const setupSchema = z.object({
  shop_name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  currency: z.enum(['IQD', 'USD']),
  language: z.enum(['ku', 'ar', 'en']),
  admin: z.object({
    username: z.string().trim().min(3).max(32),
    full_name: z.string().trim().min(2).max(80),
    password: z.string().min(6).max(200),
  }),
});

router.post('/', (req, res) => {
  const db = getDb();
  if (!setupNeeded()) throw conflict('ALREADY_SETUP', 'Setup has already been completed');
  const data = parse(setupSchema, req.body);

  const result = transaction((conn) => {
    seedMaster(conn);
    const role = conn.prepare(`SELECT id FROM roles WHERE code = 'admin'`).get();
    const uname = data.admin.username;
    const exists = conn.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
    if (exists) throw validationError('Username is already in use');

    const r = conn
      .prepare('INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)')
      .run(role.id, uname, data.admin.full_name, hashPassword(data.admin.password));
    const userId = Number(r.lastInsertRowid);

    const set = (key, value) =>
      conn.prepare(`INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    set('shop.name', data.shop_name);
    set('shop.address', data.address);
    set('shop.phone', data.phone);
    set('default.currency', data.currency);
    set('default.language', data.language);
    set('setup.completed', 'true');

    const user = { id: userId, username: uname, full_name: data.admin.full_name };
    audit(conn, {
      user,
      action: 'SETUP_COMPLETED',
      entity: 'settings',
      newValue: { shop: data.shop_name, currency: data.currency, language: data.language },
      ip: req.ip,
    });
    return userId;
  });

  res.status(201).json({ ok: true, adminId: result });
});

/** Setup status exposed on /api/meta for the client shell. */
export function setupPublicInfo() {
  return {
    needsSetup: setupNeeded(),
    shopName: getDb().prepare(`SELECT value FROM settings WHERE key='shop.name'`).get()?.value || 'Parez',
    defaultLanguage: getDb().prepare(`SELECT value FROM settings WHERE key='default.language'`).get()?.value || 'ku',
    defaultCurrency: getDb().prepare(`SELECT value FROM settings WHERE key='default.currency'`).get()?.value || 'IQD',
    backupWarnDays: config.backupWarnDays,
  };
}

export default router;
