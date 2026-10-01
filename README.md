# Parez — Shop Accounting & Payment Management System

A production-quality accounting, payments and reconciliation system for a shop in **Akre, Kurdistan Region of Iraq**.
Supports **FastPay**, **NassWallet**, **Ronaki Project** instalments, cash, expenses, receipts, reports, daily closing, audit trail and backups — in **Kurdish (Sorani) / Arabic / English** with full RTL, and strict **IQD / USD** currency separation.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Node 22+ (ESM), Express 4, zod validation, **SQLite via `node:sqlite`** (no server to install), WAL mode |
| Frontend | React 19 + TypeScript, Vite 6, Tailwind CSS 4, React Router 7 |
| Tests    | Node built-in test runner (`node --test`) — 52 tests + end-to-end smoke script |

## Quick start

```bash
npm install
npm run build     # build the frontend into client/dist
npm start         # production server on http://127.0.0.1:4177
```

First visit → **initial setup** (shop name, currency, language, admin account), then log in.

Development (API + hot-reloading client together):

```bash
npm run dev       # server :4177 + Vite :5173 (proxies /api)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Run the production server (serves the built SPA + API) |
| `npm run dev` | Dev mode: API with `--watch` + Vite dev server |
| `npm run build` | Production build of `client/` → `client/dist/` |
| `npm test` | All backend tests (`server/test/*.test.js`) |
| `npm run typecheck` | TypeScript check of the frontend |
| `npm run seed` / `npm run seed -- --demo` | Seed master data (optionally with removable demo data) |

## Data & configuration

- Database file: `data/parez.db` (created automatically). Override with `PAREZ_DB_PATH`.
- Backups: `data/backups/`. Override root with `PAREZ_DATA_DIR`.
- Other env vars: `PORT` (default 4177), `HOST`, `SESSION_TTL_HOURS`, `MAX_LOGIN_ATTEMPTS`,
  `LOGIN_LOCK_MINUTES`, `BACKUP_WARN_DAYS`, `PAREZ_DEMO=1` (load demo data at boot).
  A `.env` file in the project root is also read.

## Integrity rules (the core of the system)

- **All money is stored as integer minor units** (`amount_minor`, ×100) — never floats.
- **IQD and USD are never summed** — every balance, total and report is grouped per currency.
- **Single posting path**: every money movement is one `transactions` row → `ledger_entries`
  (expenses and Ronaki payments link their detail rows to the same transaction — no double counting).
- **No silent edits**: reversing/cancelling/refunding/editing a completed transaction requires a
  reason and is written to the append-only audit log. Duplicates are blocked (`409 DUPLICATE_SUSPECTED`)
  unless explicitly forced with a reason.
- **Day locking**: once a day is closed, backdated writes are rejected until an admin reopens it
  (reason required; the original closing is preserved inside the audit log).
- **Backups**: consistent `VACUUM INTO` snapshots; restore requires typing the exact file name,
  always writes a pre-restore safety copy first, and is audited inside the restored database.

## Testing

```bash
npm test                          # 52 unit/integration tests
node scripts/smoke.mjs            # full end-to-end smoke test (boots a real server on a temp DB)
```

The smoke test covers: setup → login → CSRF → customers → transactions (duplicate + force override)
→ expenses → ledger balances → Ronaki contracts/payments (overpayment blocked) → reports + CSV BOM →
day locking → backup → demo data load/remove → audit → receipts.

## Layout

```
server/src/
  app.js, index.js       Express app + server entry (serves client/dist SPA)
  config.js              env-driven config
  db/                    schema.sql, migrations, seed + demo data
  services/              ledger, transactions, ronaki, cash, closing, expenses,
                         reports, receipts, backup, auth, audit, settings, wallets, ...
  routes/                /api/* routers        middleware/  session, RBAC, CSRF, errors
  lib/                   money, dates (Asia/Baghdad), ids, validation, errors
server/test/             phase-based test suites
client/src/
  lib/                   api client, i18n (ku/ar/en + RTL), formatting
  ui/kit.tsx             shared components
  pages/                 Setup, Login, Dashboard, Transactions, FastPay, NassWallet,
                         Ronaki, Customers, Expenses, Income, Reports, Daily Closing,
                         Receipts, Audit, Users, Settings, Backup, Search
```
