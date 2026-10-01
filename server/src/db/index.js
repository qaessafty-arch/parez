/**
 * Database layer — node:sqlite (DatabaseSync).
 *
 * Integrity rules enforced here:
 *   - WAL mode + foreign keys on every connection
 *   - all multi-statement financial operations run inside BEGIN IMMEDIATE
 *   - money is INTEGER minor units only (schema CHECK constraints)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDb() {
  if (db) return db;
  db = openDatabase(config.dbPath);
  migrate(db);
  return db;
}

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new DatabaseSync(dbPath);
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA busy_timeout = 8000');
  conn.exec('PRAGMA synchronous = NORMAL');
  return conn;
}

/** Test hook: install an already-open connection as the singleton. */
export function setDb(conn) {
  db = conn;
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

/** Run schema + pending migrations. Idempotent. */
export function migrate(conn) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  conn.exec(schema);
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  for (const f of files) {
    const applied = conn.prepare('SELECT 1 AS x FROM schema_migrations WHERE name = ?').get(f);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    conn.exec('BEGIN IMMEDIATE');
    try {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
      conn.exec('COMMIT');
    } catch (e) {
      conn.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
}

/**
 * Run fn inside BEGIN IMMEDIATE ... COMMIT (rolled back on error).
 * Nested calls join the outer transaction (savepoint-free simple nesting).
 */
let txDepth = 0;
export function transaction(fn) {
  const conn = getDb();
  if (txDepth === 0) {
    conn.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const result = fn(conn);
      conn.exec('COMMIT');
      txDepth--;
      return result;
    } catch (e) {
      try {
        conn.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      txDepth--;
      throw e;
    }
  }
  return fn(conn); // join outer transaction
}

export function inTransaction() {
  return txDepth > 0;
}

/** Convenience query helpers */
export function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}
export function one(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}
