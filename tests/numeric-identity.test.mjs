import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomNumericUserId, isNumericUserId, allocateNumericUserId } from '../functions/_identity.js';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequestPost as changePassword } from '../functions/api/change-password.js';
import { onRequestPost as recoverPassword } from '../functions/api/recover-password.js';

test('random numeric IDs have exact string precision and no fixed account mapping', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => randomNumericUserId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) {
    assert.equal(typeof id, 'string');
    assert.ok(isNumericUserId(id));
    assert.equal(JSON.parse(JSON.stringify({ id })).id, id);
  }
  assert.equal(isNumericUserId(123), false);
  assert.equal(isNumericUserId('m'), false);
});

test('ID allocation refuses a repeatedly occupied candidate rather than overwrite an account', async () => {
  let calls = 0;
  const db = { prepare() { return { bind() { return this; }, async first() { calls++; return { id: 'occupied' }; } }; } };
  await assert.rejects(allocateNumericUserId(db), /unique user ID/);
  assert.equal(calls, 8);
});

function d1Adapter(sqlite) {
  return {
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(query).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(query).all(...args) }; },
        execute() { const result = sqlite.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async run() { return this.execute(); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'wany-numeric-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./numeric-identity-migration.test.py', import.meta.url));
  const python = `import runpy,sys,pathlib; d=runpy.run_path(sys.argv[1]); root=pathlib.Path(sys.argv[2]); p=root/'backup.sql'; d['fixture'](p); d['m'].build_plan(p,d['CONFIG'],root/'plan')`;
  const result = spawnSync('python', ['-c', python, script, folder], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sqlite = new DatabaseSync(join(folder, 'plan', 'migrated.sqlite'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  t.after(() => sqlite.close());
  return { sqlite, db: d1Adapter(sqlite) };
}

function context(path, db, body, cookie, extra = {}) {
  return { env: { DB: db, ...extra }, request: new Request(`https://wany.test/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: 'https://wany.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }) };
}

async function login(db, username, password) {
  const response = await onRequest(context('login', db, { username, password }));
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}

test('both old H credentials resolve to the same numeric D1 identity, then password change retires both', async t => {
  const { sqlite, db } = await fixture(t);
  const primary = await login(db, 'h', 'has-before');
  const alternate = await login(db, 'H', 'h-before');
  assert.equal(primary.response.status, 200);
  assert.equal(alternate.response.status, 200);
  assert.ok(isNumericUserId(primary.payload.user.id));
  assert.equal(primary.payload.user.id, alternate.payload.user.id);
  const id = primary.payload.user.id;
  const response = await changePassword(context('change-password', db, { currentPassword: 'h-before', newPassword: 'after-migration-password' }, alternate.cookie));
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT id FROM users WHERE username=?').get('h').id, id);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_password_verifiers WHERE user_id=?').get(id).n, 0);
  assert.equal((await login(db, 'h', 'has-before')).response.status, 401);
  assert.equal((await login(db, 'h', 'h-before')).response.status, 401);
  assert.equal((await login(db, 'h', 'after-migration-password')).payload.user.id, id);
  assert.equal((await (await onRequest(context('session', db, null, primary.cookie))).json()).user, null);
  assert.equal((await (await onRequest(context('session', db, null, alternate.cookie))).json()).user.id, id);
});

test('numeric admin identity authenticates by its D1 username and role', async t => {
  const { sqlite, db } = await fixture(t);
  const result = await login(db, 'admin', 'admin-before');
  assert.equal(result.response.status, 200);
  assert.ok(isNumericUserId(result.payload.user.id));
  assert.equal(result.payload.user.role, 'admin');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE action='admin_login' AND admin_user_id=?").get(result.payload.user.id).n, 2);
});

test('R2 cover fallback uses only aliases belonging to the numeric session owner', async t => {
  const { db } = await fixture(t);
  const h = await login(db, 'h', 'has-before');
  const requested = [];
  const covers = { async get(key) {
    requested.push(key);
    return key === 'covers/has/story' ? { body: 'old-cover', httpEtag: 'old', writeHttpMetadata(headers) { headers.set('Content-Type','image/png'); } } : null;
  } };
  let response = await onRequest(context('work-snapshots/cover?key=story', db, null, h.cookie, { WANY_COVERS: covers }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'old-cover');
  assert.equal(requested[1], 'covers/has/story');
  requested.length = 0;
  const m = await login(db, 'm', 'm-before');
  response = await onRequest(context('work-snapshots/cover?key=story', db, null, m.cookie, { WANY_COVERS: covers }));
  assert.equal(response.status, 404);
  assert.ok(requested.every(key => !key.startsWith('covers/has/') && !key.startsWith('covers/h/')));
});

test('recovery follows the numeric D1 account, is one-use, and invalidates sessions without changing ID', async t => {
  const { sqlite, db } = await fixture(t);
  const h = await login(db, 'h', 'has-before');
  const id = h.payload.user.id;
  const code = 'private-fixture-recovery-code';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))).toString('base64url');
  sqlite.prepare("INSERT INTO user_recovery_verifiers VALUES(?,'sha256','',?,1)").run(id, hash);
  const body = { username: 'h', recoveryCode: code, newPassword: 'recovered-password' };
  const responses = await Promise.all([recoverPassword(context('recover-password', db, body)), recoverPassword(context('recover-password', db, body))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
  assert.equal((await login(db, 'h', 'recovered-password')).payload.user.id, id);
  assert.equal((await (await onRequest(context('session', db, null, h.cookie))).json()).user, null);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM reading_history WHERE user_id=?').get(id).n, 2);
  assert.equal((await recoverPassword(context('recover-password', db, body))).status, 401);
});

test('private migration suite verifies merge, blobs, stale-plan guards and rollback', () => {
  const script = fileURLToPath(new URL('./numeric-identity-migration.test.py', import.meta.url));
  const result = spawnSync('python', [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 10 tests/);
});
