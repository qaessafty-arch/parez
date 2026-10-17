/**
 * Database layer — libSQL client (Turso in production, a local file in development).
 *
 * Integrity rules enforced here:
 *   - all multi-statement financial operations run inside transaction(), which
 *     opens a write transaction and rolls back on any error
 *   - statements inside transaction() automatically use that transaction, so
 *     services call all()/one()/run() the same way with or without one
 *   - money is INTEGER minor units only (schema CHECK constraints)
 */
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const txStore = new AsyncLocalStorage();
let client = null;
let readyPromise = null;

/** The shared client. Opened lazily from config (TURSO_DATABASE_URL or a local file). */
export function getClient() {
  if (!client) client = openDatabase(config.dbUrl, config.dbAuthToken);
  return client;
}

export function openDatabase(url, authToken) {
  return createClient({ url, authToken });
}

/** Test hook: install an already-open client as the singleton. */
export function setClient(c) {
  client = c;
  readyPromise = null;
}

export function closeDb() {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
    readyPromise = null;
  }
}

/** Run schema + pending migrations once per process. Safe to call repeatedly. */
export function ready() {
  if (!readyPromise) readyPromise = migrate(getClient());
  return readyPromise;
}

/** Local file databases: wait for locks instead of failing, and enforce foreign keys. */
function isLocal() {
  return config.dbUrl.startsWith('file:');
}

async function localPragmas(conn) {
  await conn.execute('PRAGMA busy_timeout = 8000');
  await conn.execute('PRAGMA foreign_keys = ON');
}

function current() {
  return txStore.getStore()?.tx ?? getClient();
}

function toObjects(result) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((name, i) => [name, row[i]]))
  );
}

/** All rows of a query, as plain objects. */
export async function all(sql, ...args) {
  return toObjects(await current().execute({ sql, args }));
}

/** First row of a query, or undefined. */
export async function one(sql, ...args) {
  return (await all(sql, ...args))[0];
}

/** Run a write. Returns { lastInsertRowid (number), changes }. */
export async function run(sql, ...args) {
  const r = await current().execute({ sql, args });
  return {
    lastInsertRowid: r.lastInsertRowid === undefined ? null : Number(r.lastInsertRowid),
    changes: r.rowsAffected,
  };
}

/**
 * Run several statements as one atomic batch. Inside transaction() they run
 * on that transaction, so the batch never waits on a lock the caller holds.
 */
export async function batch(statements) {
  const store = txStore.getStore();
  if (store) {
    for (const s of statements) await store.tx.execute(s);
    return;
  }
  await getClient().batch(statements, 'write');
}

/** Apply schema.sql and any pending migrations. Idempotent. */
export async function migrate(c = getClient()) {
  if (isLocal()) await localPragmas(c);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await c.executeMultiple(schema);
  await c.executeMultiple(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  for (const f of files) {
    const applied = await c.execute({ sql: 'SELECT 1 AS x FROM schema_migrations WHERE name = ?', args: [f] });
    if (applied.rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const tx = await c.transaction('write');
    try {
      await tx.executeMultiple(sql);
      await tx.execute({ sql: 'INSERT INTO schema_migrations (name) VALUES (?)', args: [f] });
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
}

/**
 * Run fn inside a write transaction (committed on success, rolled back on error).
 * Nested calls join the outer transaction.
 */
export async function transaction(fn) {
  if (txStore.getStore()) return fn();
  const tx = await getClient().transaction('write');
  try {
    if (isLocal()) await localPragmas(tx);
    const result = await txStore.run({ tx }, () => fn());
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

export function inTransaction() {
  return Boolean(txStore.getStore());
}
