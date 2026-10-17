/** Settings — shop configuration stored in DB, never hard-coded in components. */
import { all, one, run, transaction } from '../db/index.js';
import { nowIso } from '../lib/dates.js';
import { validationError } from '../lib/errors.js';
import { audit } from './audit.js';

export async function getSetting(key, fallback = null) {
  const row = await one('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value, user = null, ip = null, { audited = true } = {}) {
  await transaction(async () => {
    const before = await one('SELECT value FROM settings WHERE key = ?', key);
    await run(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      key,
      String(value),
      nowIso(),
      user ? user.id : null
    );
    if (audited && user) {
      await audit({
        user,
        action: 'SETTINGS_CHANGED',
        entity: 'settings',
        entityId: key,
        oldValue: before ? before.value : null,
        newValue: String(value),
        ip,
      });
    }
  });
}

export async function listSettings() {
  const rows = await all('SELECT key, value, updated_at FROM settings ORDER BY key');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Settings an admin may edit from the UI (with validation). */
const EDITABLE = new Set([
  'shop.name', 'shop.address', 'shop.phone', 'shop.logo', 'receipt.footer', 'receipt.prefix',
  'default.currency', 'default.language', 'tax.rate', 'commission.rules', 'backup.warn_days',
]);

export async function updateSettings(patch, user, ip) {
  const values = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE.has(key)) throw validationError(`Setting not editable: ${key}`);
    values[key] = String(value);
  }
  if (values['shop.name'] !== undefined && values['shop.name'].trim().length < 2) {
    throw validationError('Shop name must be at least 2 characters');
  }
  if (values['default.currency'] && !['IQD', 'USD'].includes(values['default.currency'])) {
    throw validationError('Default currency must be IQD or USD');
  }
  if (values['default.language'] && !['ku', 'ar', 'en'].includes(values['default.language'])) {
    throw validationError('Default language must be ku, ar or en');
  }
  if (values['tax.rate'] !== undefined) {
    const n = Number(values['tax.rate']);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw validationError('Tax rate must be 0-100');
  }
  if (values['commission.rules'] !== undefined) {
    let rules;
    try {
      rules = JSON.parse(values['commission.rules']);
    } catch {
      throw validationError('Commission rules must be valid JSON');
    }
    if (!Array.isArray(rules)) throw validationError('Commission rules must be a list');
    for (const r of rules) {
      if (r.percent != null && (!Number.isFinite(Number(r.percent)) || Number(r.percent) < 0 || Number(r.percent) > 100)) {
        throw validationError('Commission percent must be 0-100');
      }
    }
    values['commission.rules'] = JSON.stringify(rules);
  }
  await transaction(async () => {
    for (const [k, v] of Object.entries(values)) await setSetting(k, v, user, ip);
  });
  const out = {};
  for (const k of Object.keys(values)) out[k] = await getSetting(k);
  return out;
}

export async function shopInfo() {
  return {
    name: await getSetting('shop.name', 'Parez'),
    address: await getSetting('shop.address', ''),
    phone: await getSetting('shop.phone', ''),
    logo: await getSetting('shop.logo', ''),
    receipt_footer: await getSetting('receipt.footer', ''),
    receipt_prefix: await getSetting('receipt.prefix', 'PRZ'),
    default_currency: await getSetting('default.currency', 'IQD'),
    default_language: await getSetting('default.language', 'ku'),
    tax_rate: await getSetting('tax.rate', '0'),
    commission_rules: await getSetting('commission.rules', '[]'),
    backup_last_at: await getSetting('backup.last_at', ''),
    setup_completed: (await getSetting('setup.completed', 'false')) === 'true',
  };
}
