/**
 * Shop branding — logo upload and removal.
 *
 * The logo is stored in the shop_logos table and referenced from settings by
 * name. Uploads are validated by magic bytes rather than trusting the
 * extension or the browser-supplied Content-Type, and a random name is used.
 */
import { Router } from 'express';
import { one, run } from '../db/index.js';
import { requirePermission } from '../middleware/index.js';
import { getSetting, setSetting } from '../services/settings.js';
import { validationError, notFound } from '../lib/errors.js';

export const brandingRouter = Router();

const MAX_BYTES = 512 * 1024;
const NAME_PATTERN = /^logo-[a-z0-9-]+\.(png|jpg|webp)$/;

const SIGNATURES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b.slice(0, 4).toString('ascii') === 'RIFF' &&
      b.slice(8, 12).toString('ascii') === 'WEBP',
  },
];

/** Route filename -> bytes, capped at MAX_BYTES so a huge body cannot exhaust memory. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(validationError('Logo is too large (max 512 KB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function removeStoredLogo() {
  const current = await getSetting('shop.logo', '');
  if (!current || !NAME_PATTERN.test(current)) return;
  await run('DELETE FROM shop_logos WHERE name = ?', current);
}

brandingRouter.post('/logo', requirePermission('settings.manage'), async (req, res) => {
  let body;
  try {
    body = await readBody(req, MAX_BYTES);
  } catch (e) {
    return res.status(e.status || 400).json({ error: { code: e.code || 'UPLOAD_FAILED', message: e.message } });
  }
  if (body.length === 0) {
    return res.status(400).json({ error: { code: 'EMPTY_UPLOAD', message: 'No file received' } });
  }
  const sig = SIGNATURES.find((s) => s.test(body));
  if (!sig) {
    return res.status(415).json({ error: { code: 'BAD_IMAGE', message: 'Logo must be a PNG, JPEG or WebP image' } });
  }

  await removeStoredLogo();

  const name = `logo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${sig.ext}`;
  await run('INSERT INTO shop_logos (name, mime, data) VALUES (?,?,?)', name, sig.mime, body.toString('base64'));
  await setSetting('shop.logo', name, req.user, req.ip);

  res.json({ logo: `/api/branding/logo/${name}`, file_name: name, mime: sig.mime, bytes: body.length });
});

brandingRouter.get('/logo/:name', async (req, res) => {
  const name = req.params.name;
  const row = NAME_PATTERN.test(name) ? await one('SELECT mime, data FROM shop_logos WHERE name = ?', name) : null;
  if (!row) throw notFound('Logo');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(Buffer.from(row.data, 'base64'));
});

brandingRouter.delete('/logo', requirePermission('settings.manage'), async (req, res) => {
  await removeStoredLogo();
  await setSetting('shop.logo', '', req.user, req.ip);
  res.json({ ok: true, logo: '' });
});

export default brandingRouter;
