/** Master data for forms/dropdowns + shop settings routes. */
import { Router } from 'express';
import { all } from '../db/index.js';
import { requirePermission } from '../middleware/index.js';
import { shopInfo, listSettings, updateSettings } from '../services/settings.js';
import { seedDemo } from '../db/seedDemo.js';
import { clearDemoData } from '../db/seed.js';
import { parse, z } from '../lib/validate.js';

export const masterRouter = Router();

masterRouter.get('/master', async (req, res) => {
  res.json({
    services: await all('SELECT id, code, name, account_id FROM services WHERE is_active = 1 ORDER BY sort_order'),
    transaction_types: await all('SELECT id, code, name, direction FROM transaction_types WHERE is_active = 1 ORDER BY sort_order'),
    accounts: await all('SELECT id, code, name, kind, currency, account_number FROM accounts WHERE is_active = 1 ORDER BY sort_order'),
    currencies: await all('SELECT code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY sort_order'),
    payment_methods: await all('SELECT code, name FROM payment_methods WHERE is_active = 1'),
    expense_categories: await all('SELECT id, code, name FROM expense_categories WHERE is_active = 1 ORDER BY sort_order'),
    shop: await shopInfo(),
    backup_warn_days: 3,
  });
});

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('settings.manage'), async (req, res) => {
  res.json({ settings: await listSettings(), shop: await shopInfo() });
});

settingsRouter.patch('/', requirePermission('settings.manage'), async (req, res) => {
  const body = parse(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.any())])), req.body);
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    patch[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  await updateSettings(patch, req.user, req.ip);
  res.json({ settings: await listSettings(), shop: await shopInfo() });
});

settingsRouter.post('/demo/load', requirePermission('settings.manage'), async (req, res) => {
  await seedDemo();
  res.json({ settings: await listSettings(), shop: await shopInfo() });
});

settingsRouter.post('/demo/remove', requirePermission('demo.remove'), async (req, res) => {
  await clearDemoData();
  res.json({ ok: true });
});
