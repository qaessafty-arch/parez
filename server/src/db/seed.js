/**
 * Seed — idempotent master data (+ optional demo data, clearly flagged is_demo=1).
 * Usage:
 *   node server/src/db/seed.js           # master data only
 *   node server/src/db/seed.js --demo    # master data + removable demo data
 */
import { getDb, transaction } from './index.js';
import { seedDemo } from './seedDemo.js';
import { config } from '../config.js';
import { hashPassword } from '../services/auth.js';

const MASTER_ROLES = [
  {
    code: 'admin',
    name: 'Admin',
    is_system: 1,
    permissions: [
      'dashboard.view', 'transaction.view', 'transaction.create', 'transaction.edit',
      'transaction.reverse', 'transaction.cancel', 'transaction.correct',
      'customer.view', 'customer.create', 'customer.edit',
      'ronaki.view', 'ronaki.create', 'ronaki.edit', 'ronaki.payment',
      'expense.view', 'expense.create', 'expense.edit',
      'report.view', 'report.export', 'receipt.print',
      'closing.view', 'closing.perform', 'closing.reopen',
      'audit.view', 'user.manage', 'settings.manage', 'backup.manage', 'demo.remove',
    ],
  },
  {
    code: 'employee',
    name: 'Employee',
    is_system: 1,
    permissions: [
      'dashboard.view', 'transaction.view', 'transaction.create',
      'customer.view', 'customer.create', 'customer.edit',
      'ronaki.view', 'ronaki.create', 'ronaki.payment',
      'expense.view', 'expense.create',
      'report.view', 'report.export', 'receipt.print', 'closing.view',
    ],
  },
];

const MASTER_SETTINGS = {
  'shop.name': 'Parez',
  'shop.address': 'Akre, Kurdistan Region, Iraq',
  'shop.phone': '',
  'shop.logo': '',
  'setup.completed': 'false',
  'default.currency': 'IQD',
  'default.language': 'ku',
  'receipt.footer': 'Thank you for your business — Parez, Akre',
  'receipt.prefix': 'PRZ',
  'tax.rate': '0',
  'backup.last_at': '',
  'backup.warn_days': '3',
};

const CURRENCIES = [
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', decimals: 2, sort: 1 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, sort: 2 },
];

const ACCOUNTS = [
  { code: 'CASH', name: 'Shop Cash', kind: 'cash', currency: 'IQD', opening: 0, sort: 1 },
  { code: 'FASTPAY', name: 'FastPay Account', kind: 'wallet', currency: 'IQD', opening: 0, sort: 2 },
  { code: 'NASSWALLET', name: 'NassWallet Account', kind: 'wallet', currency: 'IQD', opening: 0, sort: 3 },
  { code: 'RONAKI', name: 'Ronaki Collection', kind: 'clearing', currency: 'IQD', opening: 0, sort: 4 },
  { code: 'BANK', name: 'Bank Account', kind: 'bank', currency: 'IQD', opening: 0, sort: 5 },
];

const SERVICES = [
  { code: 'fastpay', name: 'FastPay', account: 'FASTPAY', sort: 1 },
  { code: 'nasswallet', name: 'NassWallet', account: 'NASSWALLET', sort: 2 },
  { code: 'ronaki', name: 'Ronaki Project', account: 'RONAKI', sort: 3 },
  { code: 'other', name: 'Other', account: 'CASH', sort: 4 },
];

const TX_TYPES = [
  { code: 'deposit', name: 'Deposit', direction: 'in', sort: 1 },
  { code: 'withdrawal', name: 'Withdrawal', direction: 'out', sort: 2 },
  { code: 'transfer', name: 'Transfer', direction: 'transfer', sort: 3 },
  { code: 'payment_collection', name: 'Payment Collection', direction: 'in', sort: 4 },
  { code: 'customer_payment', name: 'Customer Payment', direction: 'in', sort: 5 },
  { code: 'expense', name: 'Expense', direction: 'out', sort: 6 },
  { code: 'income', name: 'Income', direction: 'in', sort: 7 },
  { code: 'commission', name: 'Commission', direction: 'in', sort: 8 },
  { code: 'cash_in', name: 'Cash In', direction: 'in', sort: 9 },
  { code: 'cash_out', name: 'Cash Out', direction: 'out', sort: 10 },
  { code: 'adjustment', name: 'Adjustment', direction: 'none', sort: 11 },
  { code: 'refund', name: 'Refund', direction: 'out', sort: 12 },
  { code: 'reversal', name: 'Reversal', direction: 'none', sort: 13 },
  { code: 'credit_sale', name: 'Credit Sale (Customer Owes)', direction: 'none', sort: 14 },
];

const PAYMENT_METHODS = [
  { code: 'cash', name: 'Cash' },
  { code: 'fastpay', name: 'FastPay' },
  { code: 'nasswallet', name: 'NassWallet' },
  { code: 'bank', name: 'Bank' },
  { code: 'credit', name: 'Credit (Owes)' },
  { code: 'other', name: 'Other' },
];

const EXPENSE_CATEGORIES = [
  { code: 'rent', name: 'Rent', sort: 1 },
  { code: 'electricity', name: 'Electricity', sort: 2 },
  { code: 'internet', name: 'Internet', sort: 3 },
  { code: 'salary', name: 'Salary', sort: 4 },
  { code: 'transportation', name: 'Transportation', sort: 5 },
  { code: 'supplies', name: 'Supplies', sort: 6 },
  { code: 'maintenance', name: 'Maintenance', sort: 7 },
  { code: 'wallet_fees', name: 'Bank/Wallet Fees', sort: 8 },
  { code: 'other', name: 'Other', sort: 9 },
];

export function seedMaster(db = getDb()) {
  transaction(() => {
    for (const c of CURRENCIES) {
      db.prepare(
        `INSERT INTO currencies (code, name, symbol, decimals, sort_order) VALUES (?,?,?,?,?)
         ON CONFLICT(code) DO NOTHING`
      ).run(c.code, c.name, c.symbol, c.decimals, c.sort);
    }
    for (const [key, value] of Object.entries(MASTER_SETTINGS)) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(key, value);
    }
    for (const r of MASTER_ROLES) {
      db.prepare(
        `INSERT INTO roles (code, name, permissions, is_system) VALUES (?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, permissions = excluded.permissions`
      ).run(r.code, r.name, JSON.stringify(r.permissions), r.is_system);
    }
    for (const a of ACCOUNTS) {
      db.prepare(
        `INSERT INTO accounts (code, name, kind, currency, opening_balance_minor, sort_order)
         VALUES (?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`
      ).run(a.code, a.name, a.kind, a.currency, a.opening, a.sort);
    }
    for (const s of SERVICES) {
      const acc = db.prepare('SELECT id FROM accounts WHERE code = ?').get(s.account);
      db.prepare(
        `INSERT INTO services (code, name, account_id, sort_order) VALUES (?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, account_id = excluded.account_id`
      ).run(s.code, s.name, acc.id, s.sort);
    }
    for (const t of TX_TYPES) {
      db.prepare(
        `INSERT INTO transaction_types (code, name, direction, is_system, sort_order) VALUES (?,?,?,1,?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, direction = excluded.direction`
      ).run(t.code, t.name, t.direction, t.sort);
    }
    for (const p of PAYMENT_METHODS) {
      db.prepare(
        `INSERT INTO payment_methods (code, name) VALUES (?,?) ON CONFLICT(code) DO UPDATE SET name = excluded.name`
      ).run(p.code, p.name);
    }
    for (const e of EXPENSE_CATEGORIES) {
      db.prepare(
        `INSERT INTO expense_categories (code, name, is_system, sort_order) VALUES (?,?,1,?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name`
      ).run(e.code, e.name, e.sort);
    }
    db.prepare(
      `INSERT INTO ronaki_projects (code, name, location) VALUES (?,?,?)
       ON CONFLICT(code) DO NOTHING`
    ).run('ronaki-akre', 'Ronaki Project — Akre', 'Akre');

    // Dev account (only in development with env var)
    if (config.devAccount?.enabled) {
      const adminRole = db.prepare('SELECT id FROM roles WHERE code = ?').get('admin');
      if (adminRole) {
        const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(config.devAccount.username);
        if (!exists) {
          const hash = hashPassword(config.devAccount.password);
          db.prepare(
            `INSERT INTO users (role_id, username, full_name, password_hash, is_active) VALUES (?,?,?,?,1)`
          ).run(adminRole.id, config.devAccount.username, config.devAccount.fullName, hash);
        }
      }
    }
  });
}

export function clearDemoData() {
  transaction(() => {
    const db = getDb();
    // Order matters for FK integrity: children first.
    db.exec(`DELETE FROM ledger_entries WHERE txn_id IN (SELECT id FROM transactions WHERE is_demo = 1)`);
    db.exec(`DELETE FROM receipts WHERE is_demo = 1`);
    db.exec(`DELETE FROM ronaki_payments WHERE is_demo = 1`);
    db.exec(`DELETE FROM ronaki_contracts WHERE is_demo = 1`);
    db.exec(`DELETE FROM expenses WHERE txn_id IN (SELECT id FROM transactions WHERE is_demo = 1)`);
    db.exec(`DELETE FROM transactions WHERE is_demo = 1`);
    db.exec(`DELETE FROM customers WHERE is_demo = 1`);
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'demo.data_loaded'`).run();
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const demo = process.argv.includes('--demo');
  seedMaster();
  if (demo) seedDemo();
  console.log(`Seed complete${demo ? ' (with demo data)' : ''}.`);
}
