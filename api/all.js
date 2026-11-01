/**
 * Vercel serverless entry point. Every /api/* request is handled by the same
 * Express app the local server uses (server/src/app.js).
 */
import { createApp } from '../server/src/app.js';

const app = createApp();

export default app;
