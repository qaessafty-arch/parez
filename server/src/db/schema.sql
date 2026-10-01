-- ============================================================
-- PAREZ — Shop Accounting & Payment Management System
-- Phase 1: Database schema (SQLite / node:sqlite)
--
-- MONEY RULES (critical):
--   * All monetary amounts are stored as INTEGER minor units
--     (value * 100, i.e. DECIMAL(18,2) equivalent). NEVER REAL/float.
--   * Every amount has an explicit `currency` column. IQD and USD
--     are never summed together — all balance queries GROUP BY currency.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Currencies & settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS currencies (
  code        TEXT PRIMARY KEY,              -- 'IQD', 'USD'
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  decimals    INTEGER NOT NULL DEFAULT 2,    -- minor-unit exponent (always 2 here)
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_by  INTEGER
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id            INTEGER PRIMARY KEY,
  base_code     TEXT NOT NULL REFERENCES currencies(code),
  quote_code    TEXT NOT NULL REFERENCES currencies(code),
  rate          TEXT NOT NULL,               -- decimal string, e.g. '1310.00'
  effective_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by    INTEGER,
  CHECK (base_code <> quote_code)
);

-- ------------------------------------------------------------
-- Users, roles, sessions (Phase 2)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- 'admin', 'employee' (extensible)
  name        TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',     -- JSON array of permission codes
  is_system   INTEGER NOT NULL DEFAULT 0,     -- system roles cannot be deleted
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,                -- scrypt: N$r$p$salt$hash
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,           -- sha256(cookie token)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------------------
-- Master data: accounts, services, transaction types, customers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (                 -- wallet_accounts / cash accounts
  id                   INTEGER PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,          -- CASH, FASTPAY, NASSWALLET, RONAKI, BANK
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('cash','wallet','bank','clearing')),
  currency             TEXT NOT NULL REFERENCES currencies(code),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,   -- INTEGER minor units
  opening_date         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now','+3 hours')),
  account_number       TEXT,                          -- external wallet/account number
  is_active            INTEGER NOT NULL DEFAULT 1,
  sort_order           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,             -- fastpay, nasswallet, ronaki, other
  name       TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id),  -- default account for this service
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transaction_types (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,             -- deposit, withdrawal, transfer, ...
  name       TEXT NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out','transfer','none')),
  is_system  INTEGER NOT NULL DEFAULT 1,       -- system types cannot be deleted
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,             -- cash, fastpay, nasswallet, bank, credit, other
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,            -- CUS-2026-000001
  full_name   TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  notes       TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(full_name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ------------------------------------------------------------
-- Transactions (Phase 4) — SINGLE SOURCE OF TRUTH for money flow.
-- Expenses and Ronaki payments also produce a transactions row
-- (details live in expenses / ronaki_payments) so no amount is
-- ever counted twice.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                 INTEGER PRIMARY KEY,
  tx_number          TEXT NOT NULL UNIQUE,           -- TX-2026-000001
  biz_date           TEXT NOT NULL,                  -- business date YYYY-MM-DD (Asia/Baghdad)
  time               TEXT NOT NULL,                  -- HH:MM (local)
  service_id         INTEGER NOT NULL REFERENCES services(id),
  type_id            INTEGER NOT NULL REFERENCES transaction_types(id),
  customer_id        INTEGER REFERENCES customers(id),
  account_id         INTEGER NOT NULL REFERENCES accounts(id),      -- primary account
  counter_account_id INTEGER REFERENCES accounts(id),               -- for transfers
  direction          TEXT NOT NULL CHECK (direction IN ('in','out','transfer','none')),
  amount_minor       INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency           TEXT NOT NULL REFERENCES currencies(code),
  commission_minor   INTEGER NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  net_minor          INTEGER NOT NULL DEFAULT 0,     -- amount - commission (or as defined per type)
  payment_method     TEXT NOT NULL DEFAULT 'cash' REFERENCES payment_methods(code),
  wallet_number      TEXT,                           -- FastPay / NassWallet account no
  reference_no       TEXT,                           -- provider reference
  description        TEXT,
  fx_rate            TEXT,                           -- optional decimal string
  fx_currency        TEXT,                           -- optional converted currency
  fx_amount_minor    INTEGER,                        -- optional converted amount
  status             TEXT NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('completed','pending','cancelled','reversed','refunded')),
  reversal_of        INTEGER REFERENCES transactions(id),
  reversed_by        INTEGER REFERENCES transactions(id),
  related_to         INTEGER REFERENCES transactions(id),  -- refunds / links to original
  receipt_id         INTEGER,
  ronaki_payment_id  INTEGER,
  expense_id         INTEGER,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  updated_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_txn_date      ON transactions(biz_date);
CREATE INDEX IF NOT EXISTS idx_txn_customer  ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_txn_service   ON transactions(service_id);
CREATE INDEX IF NOT EXISTS idx_txn_type      ON transactions(type_id);
CREATE INDEX IF NOT EXISTS idx_txn_account   ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_status    ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_reference ON transactions(reference_no);
CREATE INDEX IF NOT EXISTS idx_txn_created   ON transactions(created_at);

-- ------------------------------------------------------------
-- Ledger — derived balance entries (posted once per transaction).
-- account balance = opening_balance_minor + SUM(in) - SUM(out)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
  id          INTEGER PRIMARY KEY,
  txn_id      INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  currency    TEXT NOT NULL REFERENCES currencies(code),
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  biz_date    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id, currency);
CREATE INDEX IF NOT EXISTS idx_ledger_txn     ON ledger_entries(txn_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date    ON ledger_entries(biz_date);

-- ------------------------------------------------------------
-- Expenses (Phase 9) — detail rows; money movement lives in transactions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  is_system  INTEGER NOT NULL DEFAULT 1,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY,
  expense_number TEXT NOT NULL UNIQUE,          -- EXP-2026-000001
  txn_id        INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  category_id   INTEGER NOT NULL REFERENCES expense_categories(id),
  description   TEXT NOT NULL,
  supplier      TEXT,
  receipt_no    TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);

-- ------------------------------------------------------------
-- Ronaki Project (Phase 7)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ronaki_projects (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  location   TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS ronaki_contracts (
  id                  INTEGER PRIMARY KEY,
  contract_number     TEXT NOT NULL UNIQUE,      -- R-1042
  project_id          INTEGER NOT NULL REFERENCES ronaki_projects(id),
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  house_unit          TEXT,
  customer_ref        TEXT,
  total_required_minor INTEGER NOT NULL CHECK (total_required_minor > 0),
  currency            TEXT NOT NULL REFERENCES currencies(code),
  start_date          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now','+3 hours')),
  due_date            TEXT,                      -- for 'overdue' status
  notes               TEXT,
  is_demo             INTEGER NOT NULL DEFAULT 0,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON ronaki_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project  ON ronaki_contracts(project_id);

CREATE TABLE IF NOT EXISTS ronaki_payments (
  id             INTEGER PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,           -- RON-2026-000001
  contract_id    INTEGER NOT NULL REFERENCES ronaki_contracts(id),
  txn_id         INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
  currency       TEXT NOT NULL REFERENCES currencies(code),
  biz_date       TEXT NOT NULL,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ronaki_payments_contract ON ronaki_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_ronaki_payments_date     ON ronaki_payments(biz_date);

-- ------------------------------------------------------------
-- Receipts (Phase 10)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
  id              INTEGER PRIMARY KEY,
  receipt_number  TEXT NOT NULL UNIQUE,          -- PRZ-2026-000001
  txn_id          INTEGER NOT NULL REFERENCES transactions(id),
  customer_id     INTEGER REFERENCES customers(id),
  snapshot_json   TEXT NOT NULL,                 -- immutable print snapshot
  currency        TEXT NOT NULL,
  total_minor     INTEGER NOT NULL,
  print_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at TEXT,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_txn ON receipts(txn_id);

-- ------------------------------------------------------------
-- Daily closing (Phase 12) — one row per (date, currency)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_closings (
  id                 INTEGER PRIMARY KEY,
  closing_date       TEXT NOT NULL,
  currency           TEXT NOT NULL REFERENCES currencies(code),
  opening_cash_minor INTEGER NOT NULL,
  cash_in_minor      INTEGER NOT NULL DEFAULT 0,
  cash_out_minor     INTEGER NOT NULL DEFAULT 0,
  expected_cash_minor INTEGER NOT NULL,
  actual_cash_minor  INTEGER NOT NULL,
  difference_minor   INTEGER NOT NULL,
  balances_json      TEXT NOT NULL,              -- all account balances snapshot
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_commission_minor INTEGER NOT NULL DEFAULT 0,
  total_expense_minor INTEGER NOT NULL DEFAULT 0,
  ronaki_collected_minor INTEGER NOT NULL DEFAULT 0,
  note               TEXT,
  closed_by          INTEGER NOT NULL REFERENCES users(id),
  closed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  reopened_at        TEXT,
  reopened_by        INTEGER,
  UNIQUE (closing_date, currency)
);

-- ------------------------------------------------------------
-- Audit log (Phase 13)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  user_name  TEXT NOT NULL,
  action     TEXT NOT NULL,                      -- CREATE_TRANSACTION, EDIT_TRANSACTION, ...
  entity     TEXT NOT NULL,                      -- transaction, customer, settings, ...
  entity_id  TEXT,
  old_value  TEXT,
  new_value  TEXT,
  reason     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity   ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_logs(action);

-- ------------------------------------------------------------
-- Sequence counters for human-readable IDs (TX-2026-000001, ...)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
  name        TEXT NOT NULL,
  year        INTEGER NOT NULL,
  last_value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
);

-- ------------------------------------------------------------
-- Backup catalogue (Phase 14)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id           INTEGER PRIMARY KEY,
  file_name    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  note         TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ------------------------------------------------------------
-- Login rate limiting (security, Phase 2)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY,
  identifier  TEXT NOT NULL,                     -- username or ip
  success     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(identifier, created_at);
