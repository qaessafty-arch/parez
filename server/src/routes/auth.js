/** Authentication routes. */
import { Router } from 'express';
import { login, logout, changeOwnPassword, setupNeeded } from '../services/auth.js';
import { parse, z } from '../lib/validate.js';
import { sessionCookie, clearCookie, requireAuth } from '../middleware/index.js';
import { config } from '../config.js';

const router = Router();

router.post('/login', async (req, res) => {
  if (await setupNeeded()) {
    return res.status(409).json({ error: { code: 'SETUP_REQUIRED', message: 'Initial setup is required' } });
  }
  const body = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body);
  const { token, user } = await login(body, { ip: req.ip, userAgent: req.headers['user-agent'] || '' });
  res.setHeader('Set-Cookie', sessionCookie(token, config.sessionTtlHours * 3600));
  res.json({ user });
});

router.post('/logout', async (req, res) => {
  await logout(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ current_password: z.string().min(1), new_password: z.string().min(6).max(200) }),
    req.body
  );
  await changeOwnPassword(body, req.user, req.ip, req.sessionToken);
  res.json({ ok: true });
});

export default router;
