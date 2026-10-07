import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/api/[[path]].js';
import { verifyPassword } from '../functions/_password.js';
import { isNumericUserId } from '../functions/_identity.js';

function randomDigitString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, value => String(value % 10)).join('');
}

function randomDifferentInviteCode(excluded) {
  let candidate = randomDigitString(4);
  while (candidate === excluded) candidate = randomDigitString(4);
  return candidate;
}

function adapter(sqlite) {
  return {
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(query).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(query).all(...args) }; },
        execute() { return { meta: { changes: Number(sqlite.prepare(query).run(...args).changes) } }; },
        async run() { return this.execute(); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

async function fixture(t, migrated = true) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO schema_meta VALUES ('schema_version', '20');
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT,
      password_salt TEXT, password_hash TEXT, password_iterations INTEGER, role TEXT,
      profile_visibility TEXT, avatar_id TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE user_identity_aliases (old_user_id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE user_profile_sections (user_id TEXT REFERENCES users(id), section_type TEXT,
      reference_id TEXT, position INTEGER, is_visible INTEGER, created_at INTEGER, updated_at INTEGER,
      PRIMARY KEY(user_id, section_type, reference_id));
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
      created_at INTEGER, last_seen_at INTEGER, expires_at INTEGER);
    CREATE TABLE auth_attempt_windows (bucket_key TEXT PRIMARY KEY, window_start INTEGER, attempts INTEGER);`);
  const migrations = await Promise.all([
    readFile(new URL('../migrations/0021_invitation_registration.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0022_four_digit_invitation_codes.sql', import.meta.url), 'utf8'),
  ]);
  for (const migration of migrations) {
    assert.doesNotMatch(migration, /INSERT\\s+INTO\\s+registration_invites\\s*\\([^)]*\\)\\s*VALUES/i);
  }
  if (migrated) for (const migration of migrations) sqlite.exec(migration);
  const db = adapter(sqlite);
  // Random, ephemeral test invitations are never deployed or provisioned.
  const code = randomDigitString(4);
  const password = crypto.randomUUID();
  function invite(options = {}) {
    if (options.maxUses == null) {
      sqlite.prepare('INSERT INTO registration_invites (code, enabled, expires_at) VALUES (?, ?, ?)')
        .run(code, options.enabled ?? 1, options.expiresAt ?? null);
      return;
    }
    sqlite.prepare('INSERT INTO registration_invites (code, enabled, max_uses, expires_at) VALUES (?, ?, ?, ?)')
      .run(code, options.enabled ?? 1, options.maxUses, options.expiresAt ?? null);
  }
  function request(body = {}, options = {}) {
    return onRequest({ env: { DB: db }, request: new Request(`https://wany.test/api/${options.path ?? 'register'}`, {
      method: 'POST', headers: { Origin: options.origin ?? 'https://wany.test', 'Content-Type': 'application/json',
        'CF-Connecting-IP': options.ip ?? 'fixture' },
      body: JSON.stringify({ username: 'reader1', password, inviteCode: code, ...body }),
    }) });
  }
  return { sqlite, db, code, password, invite, request };
}

test('registration stays closed with no invitation tables or no privately added code', async t => {
  const absent = await fixture(t, false);
  assert.equal((await absent.request()).status, 503);
  const empty = await fixture(t);
  assert.equal((await empty.request()).status, 403);
  assert.equal(empty.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('one-use invitation creates only a private regular account with hashed password and normal login', async t => {
  const f = await fixture(t);
  f.invite();
  const response = await f.request({ role: 'admin', id: 'chosen', profileVisibility: 'public' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const user = f.sqlite.prepare('SELECT * FROM users').get();
  assert.ok(isNumericUserId(user.id));
  assert.equal(user.role, 'user');
  assert.equal(user.profile_visibility, 'private');
  assert.notEqual(user.password_hash, f.password);
  assert.ok(await verifyPassword(f.password, user));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM user_profile_sections').get().n, 4);
  assert.equal((await f.request({ username: 'reader2' })).status, 403);
  const login = await f.request({ username: 'reader1', password: f.password }, { path: 'login' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('disabled, expired, malformed, missing and unknown four-digit codes cannot create accounts', async t => {
  for (const options of [{ enabled: 0 }, { expiresAt: Date.now() - 1 }]) {
    const f = await fixture(t); f.invite(options);
    assert.equal((await f.request()).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  }

  const f = await fixture(t); f.invite();
  const invalidCodes = [
    randomDigitString(3),
    randomDigitString(5),
    `A${randomDigitString(3)}`,
    randomDifferentInviteCode(f.code),
  ];
  for (const inviteCode of invalidCodes) {
    assert.equal((await f.request({ inviteCode })).status, 403);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('simultaneous claims cannot exceed the privately configured invitation limit', async t => {
  const f = await fixture(t); f.invite();
  const responses = await Promise.all([f.request({ username: 'reader1' }), f.request({ username: 'reader2' })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 403]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registration_invite_claims').get().n, 1);
});

test('duplicate names roll back invitation claims and limits support multiple recipients', async t => {
  const f = await fixture(t); f.invite({ maxUses: 2 });
  assert.equal((await f.request()).status, 201);
  assert.equal((await f.request({ username: 'READER1' })).status, 409);
  assert.equal((await f.request({ username: 'reader2' })).status, 201);
  assert.equal((await f.request({ username: 'reader3' })).status, 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registration_invite_claims').get().n, 2);
});

test('failed transactional setup leaves neither account nor consumed invitation', async t => {
  const f = await fixture(t); f.invite();
  f.sqlite.exec(`CREATE TRIGGER fail_setup BEFORE INSERT ON user_profile_sections BEGIN SELECT RAISE(ABORT, 'setup failed'); END;`);
  assert.equal((await f.request()).status, 500);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registration_invite_claims').get().n, 0);
  f.sqlite.exec('DROP TRIGGER fail_setup');
  assert.equal((await f.request()).status, 201);
});

test('registration rejects cross-site posts, invalid usernames and weak passwords, and throttles attempts', async t => {
  const f = await fixture(t); f.invite();
  assert.equal((await f.request({}, { origin: 'https://other.test' })).status, 403);
  assert.equal((await f.request({ username: '_cannot_login' })).status, 400);
  assert.equal((await f.request({ password: 'short' })).status, 400);
  for (let i = 0; i < 7; i++) await f.request({ inviteCode: '' });
  assert.equal((await f.request()).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('a code revoked after initial validation cannot be consumed by a pending registration', async t => {
  const f = await fixture(t); f.invite();
  const batch = f.db.batch;
  f.db.batch = async statements => {
    if (statements.length === 6) f.sqlite.prepare('UPDATE registration_invites SET enabled = 0 WHERE code = ?').run(f.code);
    return batch(statements);
  };
  assert.equal((await f.request()).status, 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});
test('simultaneous duplicate usernames do not waste another invitation use', async t => {
  const f = await fixture(t); f.invite({maxUses: 2});
  const responses = await Promise.all([f.request(), f.request({username: 'READER1'})]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM registration_invite_claims').get().n, 1);
  assert.equal((await f.request({username: 'reader2'})).status, 201);
});
