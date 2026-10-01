/** Master data for forms/dropdowns + shop settings routes. */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requirePermission } from '../middleware/index.js';
import { shopInfo, listSettings, updateSettings } from '../services/settings.js';
import { seedDemo } from '../db/seedDemo.js';
import { clearDemoData } from '../db/seed.js';
import { parse, z } from '../lib/validate.js';

export const masterRouter = Router();

masterRouter.get('/master', (req, res) => {
  const db = getDb();
  res.json({
    services: db.prepare('SELECT id, code, name, account_id FROM services WHERE is_active = 1 ORDER BY sort_order').all(),
    transaction_types: db.prepare('SELECT id, code, name, direction FROM transaction_types WHERE is_active = 1 ORDER BY sort_order').all(),
    accounts: db
      .prepare('SELECT id, code, name, kind, currency, account_number FROM accounts WHERE is_active = 1 ORDER BY sort_order')
      .all(),
    currencies: db.prepare('SELECT code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY sort_order').all(),
    payment_methods: db.prepare('SELECT code, name FROM payment_methods WHERE is_active = 1').all(),
    expense_categories: db.prepare('SELECT id, code, name FROM expense_categories WHERE is_active = 1 ORDER BY sort_order').all(),
    shop: shopInfo(),
    backup_warn_days: Number(shopInfo().backup_last_at ? '3' : '3'),
  });
});

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('settings.manage'), (req, res) => {
  res.json({ settings: listSettings(), shop: shopInfo() });
});

settingsRouter.patch('/', requirePermission('settings.manage'), (req, res) => {
  const body = parse(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.any())])), req.body);
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    patch[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  updateSettings(patch, req.user, req.ip);
  res.json({ settings: listSettings(), shop: shopInfo() });
});

settingsRouter.post('/demo/load', requirePermission('settings.manage'), (req, res) => {
  seedDemo();
  res.json({ settings: listSettings(), shop: shopInfo() });
});

settingsRouter.post('/demo/remove', requirePermission('demo.remove'), (req, res) => {
  clearDemoData();
  res.json({ ok: true });
});
