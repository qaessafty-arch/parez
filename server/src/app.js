/** Express application assembly. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import {
  securityHeaders,
  sessionMiddleware,
  csrfGuard,
  errorHandler,
} from './middleware/index.js';
import apiRouter from './routes/index.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.use(csrfGuard);
  app.use(sessionMiddleware);

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api', apiRouter);

  // Static client (production build)
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
  }

  // SPA fallback (client-side routing)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexFile = path.join(config.clientDist, 'index.html');
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res
      .status(503)
      .type('text/plain')
      .send('Client not built. Run: npm run build  (or use npm run dev for development).');
  });

  // Unknown API route
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Unknown endpoint: ${req.method} ${req.path}` } });
  });

  app.use(errorHandler);
  return app;
}
