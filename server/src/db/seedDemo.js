/** Demo data â€” clearly flagged is_demo = 1 and removable via Admin â†’ Settings â†’ Remove demo data. */
import { getDb, transaction } from './index.js';
import { seedMaster } from './seed.js';

export function seedDemo() {
  seedMaster();
  const db = getDb();
  transaction(() => {
    const already = db.prepare(`SELECT value FROM settings WHERE key = 'demo.data_loaded'`).get();
    if (already && already.value === '1') return;

    const user = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
    const createdBy = user ? user.id : 1;
    const today = db.prepare(`SELECT strftime('%Y-%m-%d','now','+3 hours') AS d`).get().d;
    const y = today.slice(0, 4);

    const insCus = db.prepare(
      `INSERT INTO customers (code, full_name, phone, address, notes, is_demo, created_by)
       VALUES (?,?,?,?,?,1,?)`
    );
    const names = [
      ['Customer A', '07501234567'],
      ['Customer B', '07507654321'],
      ['Customer C', '07701112233'],
    ];
    const cusIds = names.map((n, i) => {
      // Demo IDs live in a reserved 900000+ band so they never collide with
      // sequence-allocated real IDs (sequences start at 1 and never reach it).
      const r = insCus.run(`CUS-${y}-${String(i + 1 + 900000).padStart(6, '0')}`, n[0], n[1], 'Akre', 'Demo customer', createdBy);
      return Number(r.lastInsertRowid);
    });

    const svc = (code) => db.prepare('SELECT id, account_id FROM services WHERE code = ?').get(code);
    const type = (code) => db.prepare('SELECT id, direction FROM transaction_types WHERE code = ?').get(code);
    const cash = db.prepare(`SELECT id FROM accounts WHERE code = 'CASH'`).get();

    const insTxn = db.prepare(`
      INSERT INTO transactions
        (tx_number, biz_date, time, service_id, type_id, customer_id, account_id, counter_account_id,
         direction, amount_minor, currency, commission_minor, net_minor, payment_method, reference_no,
         description, status, is_demo, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'completed', 1, ?)`);

    let txSeq = 0;
    const mk = (svcCode, typeCode, customerId, accountId, direction, amount, commission, ref, desc) => {
      txSeq += 1;
      const s = svc(svcCode);
      const t = type(typeCode);
      const net = direction === 'in' ? amount - commission : direction === 'out' ? amount - commission : amount;
      const r = insTxn.run(
        `TX-${y}-${String(txSeq + 900000).padStart(6, '0')}`, today, '10:30', s.id, t.id, customerId,
        accountId, null, direction, amount, 'IQD', commission, net, 'cash', ref, desc, createdBy
      );
      const id = Number(r.lastInsertRowid);
      // ledger (mirror of services/ledger.js rules)
      const post = (acc, dir, amt) =>
        db.prepare(
          `INSERT INTO ledger_entries (txn_id, account_id, currency, direction, amount_minor, biz_date) VALUES (?,?,?,?,?,?)`
        ).run(id, acc, 'IQD', dir, amt, today);
      if (direction === 'in') post(accountId, 'in', amount);
      else if (direction === 'out') post(accountId, 'out', Math.max(0, amount - commission));
      return id;
    };

    mk('fastpay', 'withdrawal', cusIds[0], svc('fastpay').account_id, 'out', 250000 * 100, 2500 * 100, 'FP-DEMO-1', 'FastPay withdrawal (demo)');
    mk('fastpay', 'deposit', cusIds[1], cash.id, 'in', 500000 * 100, 5000 * 100, 'FP-DEMO-2', 'Cash deposit for FastPay (demo)');
    mk('nasswallet', 'customer_payment', cusIds[2], svc('nasswallet').account_id, 'in', 150000 * 100, 1500 * 100, 'NW-DEMO-1', 'NassWallet payment (demo)');

    // Ronaki demo
    const proj = db.prepare(`SELECT id FROM ronaki_projects LIMIT 1`).get();
    const ron = db.prepare(
      `INSERT INTO ronaki_contracts (contract_number, project_id, customer_id, house_unit, total_required_minor,
        currency, is_demo, created_by) VALUES (?,?,?,?,?,?,1,?)`
    ).run(`R-DEMO-1001`, proj.id, cusIds[0], 'H-12', 1000000 * 100, 'IQD', createdBy);
    const contractId = Number(ron.lastInsertRowid);

    const addRonaki = (amount, idx) => {
      const txId = mk('ronaki', 'payment_collection', cusIds[0], cash.id, 'in', amount * 100, 0, `RON-DEMO-${idx}`, 'Ronaki payment (demo)');
      db.prepare(
        `INSERT INTO ronaki_payments (payment_number, contract_id, txn_id, amount_minor, currency, biz_date, is_demo, created_by)
         VALUES (?,?,?,?,?,?,1,?)`
      ).run(`RON-${y}-${String(idx + 900000).padStart(6, '0')}`, contractId, txId, amount * 100, 'IQD', today, createdBy);
    };
    addRonaki(300000, 1);
    addRonaki(250000, 2);

    // Expense demo
    const expTxn = mk('other', 'expense', null, cash.id, 'out', 45000 * 100, 0, null, 'Electricity bill (demo)');
    const cat = db.prepare(`SELECT id FROM expense_categories WHERE code = 'electricity'`).get();
    db.prepare(
      `INSERT INTO expenses (expense_number, txn_id, category_id, description, supplier, receipt_no) VALUES (?,?,?,?,?,?)`
    ).run(`EXP-${y}-900001`, expTxn, cat.id, 'Electricity bill (demo)', 'Korek', 'R-991');

    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('demo.data_loaded', '1')`).run();
  });
}
