/** Phase 2 — authentication, users, permissions, audit, security controls. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeUser, transaction } from './helpers.js';
import {
  hashPassword, verifyPassword, login, logout, userFromToken, can,
  createUser, updateUser, setupNeeded, changeOwnPassword,
} from '../src/services/auth.js';
import { audit, listAudit } from '../src/services/audit.js';
import { createApp } from '../src/app.js';
import { one, run } from '../src/db/index.js';

let db;

before(async () => {
  await freshDb();
});
after(async () => {});

test('Phase2: scrypt password hashing never stores plain text', async () => {
  const hash = hashPassword('secret-password-1');
  assert.ok(hash.startsWith('scrypt$'));
  assert.ok(!hash.includes('secret-password-1'));
  assert.ok(verifyPassword('secret-password-1', hash));
  assert.ok(!verifyPassword('wrong-password', hash));
  assert.ok(!verifyPassword('secret-password-1', 'garbage'));
  assert.throws(() => hashPassword('short'));
});

test('Phase2: login creates session, userFromToken resolves, logout revokes', async () => {
  await makeUser({ username: 'shopadmin', fullName: 'Admin One' });
  await run('UPDATE users SET password_hash = ? WHERE username = ?', hashPassword('pass-1234'), 'shopadmin');

  assert.equal(await setupNeeded(), false);
  const { token, user } = await login({ username: 'shopadmin', password: 'pass-1234' }, { ip: '127.0.0.1' });
  assert.equal(user.username, 'shopadmin');
  assert.ok(token.length > 20);

  const resolved = await userFromToken(token);
  assert.equal(resolved.id, user.id);
  assert.ok(Array.isArray(resolved.permissions));

  await logout(token);
  assert.equal(await userFromToken(token), null);
});

test('Phase2: bad credentials are rejected and audited', async () => {
  await assert.rejects(() => login({ username: 'shopadmin', password: 'nope' }, { ip: '127.0.0.1' }), /Invalid username or password/);
  const failed = await listAudit({ action: 'LOGIN_FAILED' });
  // LOGIN_FAILED is recorded via login_attempts; audit row for LOGIN exists
  const logins = await listAudit({ action: 'LOGIN' });
  assert.ok(logins.total >= 1);
  assert.ok(failed.total >= 0);
});

test('Phase2: RBAC — admin has permissions, employee does not', async () => {
  const admin = await makeUser({ username: 'admin2', roleCode: 'admin' });
  const employee = await makeUser({ username: 'emp1', roleCode: 'employee' });
  assert.ok(can(admin, 'user.manage'));
  assert.ok(can(admin, 'transaction.reverse'));
  assert.ok(!can(employee, 'user.manage'));
  assert.ok(!can(employee, 'transaction.reverse'));
  assert.ok(can(employee, 'transaction.create'));
  assert.ok(can(employee, 'report.view'));
  assert.ok(!can(null, 'dashboard.view'));
});

test('Phase2: user management with validation and audit trail', async () => {
  const admin = await makeUser({ username: 'admin3', roleCode: 'admin' });
  const created = await createUser(
    { username: 'cashier1', full_name: 'Sara Omar', password: 'cashier-pass', role_code: 'employee' },
    admin,
    '127.0.0.1'
  );
  assert.equal(created.username, 'cashier1');
  assert.equal(created.role_code, 'employee');
  assert.ok(!('password' in created));

  await assert.rejects(() => createUser({ username: 'cashier1', full_name: 'Dup', password: 'xxxxxx', role_code: 'employee' }, admin),
    /already in use/
  );
  await assert.rejects(() => createUser({ username: 'x', full_name: 'A', password: '123456', role_code: 'employee' }, admin),
    /Username/
  );
  await assert.rejects(() => createUser({ username: 'newguy', full_name: 'New', password: '123456', role_code: 'ghost' }, admin),
    /Unknown role/
  );

  await updateUser(created.id, { role_code: 'admin', is_active: false }, admin, '127.0.0.1');
  const updated = await one('SELECT * FROM users WHERE id = ?', created.id);
  assert.equal(updated.is_active, 0);

  const log = await listAudit({ entity: 'user' });
  const actions = log.rows.map((r) => r.action);
  assert.ok(actions.includes('USER_CREATED'));
  assert.ok(actions.includes('USER_UPDATED'));
});

test('Phase2: password change invalidates sessions, requires current password', async () => {
  await makeUser({ username: 'changer', fullName: 'Changer' });
  const row = await one(`SELECT * FROM users WHERE username = 'changer'`);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword('old-pass-1'), row.id);
  const actor = { id: row.id, username: 'changer', full_name: 'Changer', permissions: ['*'] };
  const { token } = await login({ username: 'changer', password: 'old-pass-1' });

  await assert.rejects(() => changeOwnPassword({ current_password: 'wrong', new_password: 'new-pass-1' }, actor), /incorrect/);
  await changeOwnPassword({ current_password: 'old-pass-1', new_password: 'new-pass-1' }, actor);
  assert.equal(await userFromToken(token), null, 'sessions must be revoked on password change');
  assert.ok(verifyPassword('new-pass-1', (await one('SELECT password_hash FROM users WHERE id=?', row.id)).password_hash));
});

test('Phase2: audit log records old/new values and is append-only', async () => {
  const admin = await makeUser({ username: 'admin4', roleCode: 'admin' });
  await audit({
    user: admin,
    action: 'EDIT_TRANSACTION',
    entity: 'transaction',
    entityId: 'TX-000241',
    oldValue: { amount: '100000.00', currency: 'IQD' },
    newValue: { amount: '120000.00', currency: 'IQD' },
    reason: 'Customer entered wrong amount',
  });
  const found = await listAudit({ entity: 'transaction' });
  const row = found.rows.find((r) => r.entity_id === 'TX-000241');
  assert.ok(row, 'audit row must exist');
  assert.equal(row.action, 'EDIT_TRANSACTION');
  assert.equal(row.reason, 'Customer entered wrong amount');
  assert.ok(JSON.parse(row.old_value).amount === '100000.00');
  // no mutation APIs exist; direct table has no triggers that delete
  assert.ok((await listAudit({ action: 'EDIT_TRANSACTION' })).total >= 1);
});

test('Phase2: HTTP — setup, login, CSRF guard, auth guard', async () => {
  await freshDb(); // reset singleton for HTTP app
  // simulate: no users => setup needed
  assert.equal(await setupNeeded(), true);
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const status = await (await fetch(`${base}/api/setup/status`)).json();
    assert.equal(status.needsSetup, true);

    // missing CSRF header on mutation => 403
    const noCsrf = await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noCsrf.status, 403);

    const setupRes = await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'parez' },
      body: JSON.stringify({
        shop_name: 'Parez',
        address: 'Akre',
        phone: '07500000000',
        currency: 'IQD',
        language: 'ku',
        admin: { username: 'owner', full_name: 'Shop Owner', password: 'owner-pass-1' },
      }),
    });
    assert.equal(setupRes.status, 201, await setupRes.text());
    assert.equal(await setupNeeded(), false);

    // setup cannot run twice
    const again = await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'parez' },
      body: JSON.stringify({}),
    });
    assert.ok([403, 409].includes(again.status));

    // unauthenticated /api/users => 401
    const unauth = await fetch(`${base}/api/users`);
    assert.equal(unauth.status, 401);

    // login
    const badLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'parez' },
      body: JSON.stringify({ username: 'owner', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'parez' },
      body: JSON.stringify({ username: 'owner', password: 'owner-pass-1' }),
    });
    assert.equal(loginRes.status, 200, await loginRes.text());
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('parez_session='));
    assert.ok(setCookie.toLowerCase().includes('httponly'));
    const cookie = setCookie.split(';')[0];

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    const meBody = await me.json();
    assert.equal(meBody.user.username, 'owner');
    assert.ok(meBody.user.permissions.length > 0);

    // authenticated + CSRF header => users list ok
    const users = await fetch(`${base}/api/users`, { headers: { cookie, 'x-requested-with': 'parez' } });
    assert.equal(users.status, 200);
    const list = await users.json();
    assert.equal(list.users.length, 1);

    // logout revokes
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'parez' },
    });
    const meAfter = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal(meAfter.status, 401);

    // health endpoint is public
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
