/** On Vercel there is no durable disk: without a Turso URL the app must refuse to start. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
delete process.env.TURSO_DATABASE_URL;

test('ready() rejects on Vercel when no Turso database is configured', async () => {
  const { ready } = await import('../src/db/index.js');
  await assert.rejects(() => ready(), /TURSO_DATABASE_URL is not set/);
});
