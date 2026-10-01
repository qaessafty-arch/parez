/** End-to-end smoke test: boots a real server on a temp DB and exercises the full flow. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parez-smoke-'));
const dbFile = path.join(tmp, 'parez.db');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';
let failures = 0;

async function call(p, { method = 'GET', body, expect = 200 } = {}) {
  const headers = { 'X-Requested-With': 'parez' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const c of sc) {
    if (c.startsWith('parez_session=')) cookie = c.split(';')[0];
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  const ok = res.status === expect;
  if (!ok) {
    failures++;
    console.log(`  FAIL ${method} ${p} -> ${res.status} (expected ${expect}) ${text.slice(0, 300)}`);
  } else {
    console.log(`  ok   ${method} ${p} -> ${res.status}`);
  }
  return { status: res.status, json, text, ok };
}

function check(label, cond) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PAREZ_DB_PATH: dbFile, PAREZ_DATA_DIR: tmp, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  const up = await waitForHealth();
  if (!up) throw new Error('server did not start');

  console.log('\n-- boot & SPA --');
  check('health', (await call('/api/health')).json?.ok === true);
  check('setup status needsSetup=true', (await call('/api/setup/status')).json?.needsSetup === true);
  const spa = await call('/');
  check('SPA index.html served', spa.ok && spa.text.includes('id="root"'));
  const spaDeep = await call('/transactions');
  check('SPA deep link fallback', spaDeep.ok && spaDeep.text.includes('id="root"'));
  check('login before setup -> SETUP_REQUIRED', (await call('/api/auth/login', { method: 'POST', body: { username: 'x', password: 'x' }, expect: 409 })).json?.error?.code === 'SETUP_REQUIRED');
  check('auth guard 401', (await call('/api/meta', { expect: 401 })).status === 401);

  console.log('\n-- setup & login --');
  check('POST setup', (await call('/api/setup', {
    method: 'POST', expect: 201,
    body: {
      shop_name: 'Smoke Shop', address: 'Akre', phone: '07500000000',
      currency: 'IQD', language: 'ku',
      admin: { username: 'boss', full_name: 'The Boss', password: 'secret123' },
    },
  })).json?.ok === true);
  check('setup twice -> ALREADY_SETUP', (await call('/api/setup', { method: 'POST', expect: 409, body: { shop_name: 'Test Shop', currency: 'IQD', language: 'ku', admin: { username: 'aaa', full_name: 'bbb', password: 'cccccc' } } })).json?.error?.code === 'ALREADY_SETUP');
  check('login ok', (await call('/api/auth/login', { method: 'POST', body: { username: 'boss', password: 'secret123' } })).json?.user?.username === 'boss');
  const meta = (await call('/api/meta')).json;
  check('meta user admin', meta?.user?.role_code === 'admin' && meta?.shopName === 'Smoke Shop');
  const master = (await call('/api/master/master')).json;
  check('master data', master?.services?.length === 4 && master?.accounts?.length >= 5 && master?.transaction_types?.length >= 10);
  const csrfMissing = await fetch(BASE + '/api/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ full_name: 'No CSRF' }),
  });
  check('CSRF blocked without header', csrfMissing.status === 403);

  console.log('\n-- core money flow --');
  const cus = (await call('/api/customers', { method: 'POST', expect: 201, body: { full_name: 'Ahmed Ali', phone: '07501234567' } })).json;
  check('customer created', Boolean(cus?.code?.startsWith('CUS-')));
  const cashId = master.accounts.find((a) => a.code === 'CASH').id;
  const fpId = master.accounts.find((a) => a.code === 'FASTPAY').id;

  const txn = (await call('/api/transactions', {
    method: 'POST', expect: 201,
    body: { service_code: 'fastpay', type_code: 'withdrawal', customer_id: cus.id, account_id: fpId, amount: '250000', currency: 'IQD', commission: '2500', reference_no: 'FP-100', receipt: true },
  })).json;
  check('fastpay txn + auto receipt', Boolean(txn.transaction?.tx_number) && Boolean(txn.receipt?.receipt_number));
  check('commission stored as minor', txn.transaction.commission_minor === 250000);

  const dup = await call('/api/transactions', {
    method: 'POST', expect: 409,
    body: { service_code: 'fastpay', type_code: 'withdrawal', customer_id: cus.id, account_id: fpId, amount: '250000', currency: 'IQD', commission: '2500', reference_no: 'FP-100' },
  });
  check('duplicate detected', dup.json?.error?.code === 'DUPLICATE_SUSPECTED');
  const forced = await call('/api/transactions', {
    method: 'POST', expect: 201,
    body: { service_code: 'fastpay', type_code: 'withdrawal', customer_id: cus.id, account_id: fpId, amount: '250000', currency: 'IQD', commission: '2500', reference_no: 'FP-100', force: true, force_reason: 'second legit payment same ref' },
  });
  check('force override works', Boolean(forced.json?.transaction?.id));

  const cashTxn = (await call('/api/transactions', {
    method: 'POST', expect: 201,
    body: { service_code: 'other', type_code: 'cash_in', account_id: cashId, amount: '500000', currency: 'IQD', commission: '0', description: 'counter sale' },
  })).json;
  check('cash in posted', cashTxn.transaction.direction === 'in');

  const list = (await call('/api/transactions?limit=10')).json;
  check('txn list total=3', list.total === 3);
  check('totals grouped per currency', list.totals[0].currency === 'IQD' && list.totals[0].inflow_minor > 0);

  const expense = (await call('/api/expenses', {
    method: 'POST', expect: 201,
    body: { category_id: master.expense_categories[0].id, description: 'Electricity', amount: '45000', currency: 'IQD' },
  })).json;
  check('expense = 4500000 minor', expense.transaction.amount_minor === 4500000);

  const balances = (await call('/api/cash/balances')).json;
  const cashBal = balances.balances.find((b) => b.code === 'CASH' && b.currency === 'IQD');
  check('cash balance = 500000 - 45000 (display)', cashBal.balance_minor === 45500000);

  console.log('\n-- ronaki --');
  const project = master ? (await call('/api/ronaki/projects')).json.projects[0] : null;
  const contract = (await call('/api/ronaki/contracts', {
    method: 'POST', expect: 201,
    body: { contract_number: 'R-9001', project_id: project.id, customer_id: cus.id, total_required: '100000', currency: 'IQD' },
  })).json;
  check('contract total 10000000 minor', contract.total_required_minor === 10000000);
  const pay = (await call(`/api/ronaki/contracts/${contract.id}/payments`, {
    method: 'POST', expect: 201, body: { amount: '30000', currency: 'IQD', receipt: false },
  })).json;
  check('ronaki payment remaining 7000000', pay.contract.remaining_minor === 7000000);
  const over = await call(`/api/ronaki/contracts/${contract.id}/payments`, {
    method: 'POST', expect: 400, body: { amount: '90000', currency: 'IQD' },
  });
  check('overpayment blocked', over.json?.error?.code === 'OVERPAYMENT');

  console.log('\n-- reports / closing / backup --');
  const report = (await call('/api/reports/commission?from=2000-01-01&to=2099-12-31')).json;
  check('commission report rows', report.count === 2 && report.totals[0].commission === '5,000');
  const csvRes = await fetch(`${BASE}/api/reports/transactions?format=csv&from=2000-01-01&to=2099-12-31`, { headers: { Cookie: cookie } });
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
  check('CSV has BOM', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf);

  const preview = (await call('/api/closing/preview')).json;
  const expIqd = preview.cash.find((c) => c.currency === 'IQD');
  // 500,000 cash in - 45,000 expense + 30,000 ronaki payment = 485,000
  check('closing preview expected = 485000', expIqd.expected_minor === 48500000);
  const closed = (await call('/api/closing', { method: 'POST', expect: 201, body: { actual: { IQD: '485000' } } })).json;
  check('closing difference 0', closed.closings[0].difference_minor === 0);
  const locked = await call('/api/transactions', {
    method: 'POST', expect: 400,
    body: { service_code: 'other', type_code: 'cash_in', account_id: cashId, amount: '10', currency: 'IQD' },
  });
  check('closed day locked', locked.json?.error?.code === 'DAY_CLOSED');

  const backup = (await call('/api/backups', { method: 'POST', expect: 201, body: { note: 'smoke' } })).json;
  check('backup file created', backup.file_name?.endsWith('.db'));
  const backups = (await call('/api/backups')).json;
  check('backup listed + no warning', backups.backups.length === 1 && backups.needs_backup === false);

  console.log('\n-- demo data & audit --');
  check('demo load', (await call('/api/settings/demo/load', { method: 'POST' })).json !== null);
  const demoCus = (await call('/api/customers?q=Customer')).json;
  check('demo customers present', demoCus.total >= 3);
  check('demo remove', (await call('/api/settings/demo/remove', { method: 'POST' })).json?.ok === true);
  const afterDemo = (await call('/api/customers?q=Customer')).json;
  check('demo customers gone', afterDemo.total === 0);
  const audit = (await call('/api/audit?limit=200')).json;
  check('audit trail recorded', audit.total >= 10 && audit.rows.some((r) => r.action === 'RESTORE' || r.action === 'BACKUP' || r.action === 'DAILY_CLOSING'));
  check('search works', (await call('/api/search?q=Ahmed')).json.results.some((r) => r.kind === 'customer'));

  console.log('\n-- receipt render --');
  const receipt = (await call(`/api/receipts/${txn.receipt.receipt_number}`)).json;
  check('receipt snapshot complete', receipt.snapshot.shop.name === 'Smoke Shop' && receipt.snapshot.transaction.amount_minor === 25000000);
  const printed = (await call(`/api/receipts/${txn.receipt.id}/print`, { method: 'POST' })).json;
  check('print count incremented', printed.print_count >= 1);
} catch (e) {
  failures++;
  console.error('SMOKE CRASH:', e);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(failures === 0 ? '\nSMOKE: ALL PASS' : `\nSMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
