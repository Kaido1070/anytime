import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequestPost as adminLogin } from '../functions/api/admin-login.js';
import { onRequestPost as changePassword } from '../functions/api/change-password.js';

async function credential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 25000 }, key, 256);
  const encode = value => Buffer.from(value).toString('base64url');
  return { password_salt: encode(salt), password_hash: encode(bits), password_iterations: 25000 };
}

function database(user, version = '20') {
  const writes = [];
  const reads = [];
  const db = {
    writes, reads,
    prepare(query) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          reads.push(query);
          if (query.includes('SELECT value FROM schema_meta')) return { value: version };
          if (query.includes('sqlite_master')) return { name: 'admin_audit_log' };
          if (query.includes('FROM sessions s')) return { ...user, expires_at: Date.now() + 60000 };
          if (query.includes('FROM users')) {
            if (query.includes("role = 'admin'") && user.role !== 'admin') return null;
            if (query.includes('username = ?') && String(this.args[0]).toLowerCase() !== user.username.toLowerCase()) return null;
            return user;
          }
          return null;
        },
        async all() { return { results: [{ name: 'role' }] }; },
        async run() { writes.push({ query, args: this.args }); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
  return db;
}

function context(path, db, body, env = {}) {
  return {
    env: { DB: db, ...env },
    request: new Request(`https://wany.test/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: 'https://wany.test', Cookie: 'anytime_session=current', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
  };
}

test('duplicate legacy accounts do not block health or trigger account repair', async () => {
  const db = database({ id: 'yas', username: 'Y', role: 'user' });
  for (let n = 0; n < 2; n++) assert.equal((await onRequest(context('health', db))).status, 200);
  assert.deepEqual(db.writes, []);
  assert.equal(db.reads.filter(q => q.includes('schema_meta')).length, 1);
  assert.equal(db.reads.filter(q => q.includes('FROM users')).length, 0);
});

test('old schema produces an explicit migration requirement without mutation', async () => {
  const db = database({}, '14');
  const response = await onRequest(context('health', db));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'SCHEMA_MIGRATION_REQUIRED');
  assert.deepEqual(db.writes, []);
});

test('legacy ID and uppercase username can log in without rewriting their credentials', async () => {
  const user = { id: 'yas', username: 'Y', name: 'Y', role: 'user', ...await credential('old-password') };
  const db = database(user);
  const response = await onRequest(context('login', db, { username: 'y', password: 'old-password' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, 'yas');
  assert.ok(response.headers.get('Set-Cookie').includes('HttpOnly'));
  assert.ok(db.writes.every(w => !/UPDATE users|DELETE FROM users|CREATE|ALTER/.test(w.query)));
});

test('failed admin login ignores provisioning secret and makes no writes', async () => {
  const db = database({ id: 'admin', username: 'Admin', role: 'admin', ...await credential('actual-password') });
  const response = await adminLogin(context('admin-login', db, { username: 'admin', password: 'wrong' }, { ADMIN_INITIAL_PASSWORD: 'different-password' }));
  assert.equal(response.status, 401);
  assert.deepEqual(db.writes, []);
});

test('admin role with a random ID authenticates by stored username', async () => {
  const db = database({ id: crypto.randomUUID(), username: 'manager', role: 'admin', ...await credential('actual-password') });
  const response = await adminLogin(context('admin-login', db, { username: 'manager', password: 'actual-password' }));
  assert.equal(response.status, 200);
  assert.ok(db.writes.every(w => !/UPDATE users|DELETE FROM friendships|DELETE FROM activity_events|CREATE|ALTER/.test(w.query)));
});

test('an ordinary account named admin cannot use the admin endpoint', async () => {
  const db = database({ id: 'ordinary', username: 'Admin', role: 'user', ...await credential('actual-password') });
  assert.equal((await adminLogin(context('admin-login', db, { username: 'admin', password: 'actual-password' }))).status, 401);
  assert.deepEqual(db.writes, []);
});

test('incorrect current password never changes credentials or sessions', async () => {
  const db = database({ id: 'has', username: 'H', role: 'user', ...await credential('actual-password') });
  const response = await changePassword(context('change-password', db, { currentPassword: 'wrong', newPassword: 'new-password' }));
  assert.equal(response.status, 400);
  assert.deepEqual(db.writes, []);
});


test('source migrations never seed real credentials or revive the deleted compatibility bridge', async () => {
  const initial = await readFile(new URL('../migrations/0001_phase2.sql', import.meta.url), 'utf8');
  const recovery = await readFile(new URL('../migrations/0013_account_recovery.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../scripts/migrate-numeric-user-ids.py', import.meta.url), 'utf8');
  assert.doesNotMatch(initial, /INSERT(?: OR IGNORE)? INTO users/i);
  assert.doesNotMatch(recovery, /INSERT(?: OR IGNORE)? INTO account_recovery/i);
  assert.doesNotMatch(migration, /legacy-auth-compat|compat\['password_hashes'\]/);
  await assert.rejects(access(new URL('../scripts/legacy-auth-compat.json', import.meta.url)));
});
