/** First-run setup: creates shop settings + initial admin account. */
import { Router } from 'express';
import { all, one, run, transaction } from '../db/index.js';
import { seedMaster } from '../db/seed.js';
import { setupNeeded, hashPassword } from '../services/auth.js';
import { audit } from '../services/audit.js';
import { parse, z } from '../lib/validate.js';
import { conflict, validationError } from '../lib/errors.js';
import { config } from '../config.js';

const router = Router();

router.get('/status', async (req, res) => {
  res.json({ needsSetup: await setupNeeded() });
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

router.post('/', async (req, res) => {
  if (!(await setupNeeded())) throw conflict('ALREADY_SETUP', 'Setup has already been completed');
  const data = parse(setupSchema, req.body);

  const result = await transaction(async () => {
    await seedMaster();
    const role = await one(`SELECT id FROM roles WHERE code = 'admin'`);
    const uname = data.admin.username;
    const exists = await one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', uname);
    if (exists) throw validationError('Username is already in use');

    const r = await run(
      'INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?,?,?,?)',
      role.id,
      uname,
      data.admin.full_name,
      hashPassword(data.admin.password)
    );
    const userId = Number(r.lastInsertRowid);

    const set = (key, value) =>
      run(
        `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        value
      );
    await set('shop.name', data.shop_name);
    await set('shop.address', data.address);
    await set('shop.phone', data.phone);
    await set('default.currency', data.currency);
    await set('default.language', data.language);
    await set('setup.completed', 'true');

    const user = { id: userId, username: uname, full_name: data.admin.full_name };
    await audit({
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
export async function setupPublicInfo() {
  const value = async (key) => (await one(`SELECT value FROM settings WHERE key = ?`, key))?.value;
  return {
    needsSetup: await setupNeeded(),
    shopName: (await value('shop.name')) || 'Parez',
    defaultLanguage: (await value('default.language')) || 'ku',
    defaultCurrency: (await value('default.currency')) || 'IQD',
    backupWarnDays: config.backupWarnDays,
  };
}

export default router;
