import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].js';
import { verifyPassword } from '../functions/_password.js';
import { verifySecurityAnswer } from '../functions/_security-question.js';
import { isNumericUserId } from '../functions/_identity.js';

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
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec([
    'PRAGMA foreign_keys = ON;',
    "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);",
    "INSERT INTO schema_meta VALUES ('schema_version', '20');",
    "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT, password_salt TEXT, password_hash TEXT, password_iterations INTEGER, role TEXT, profile_visibility TEXT, avatar_id TEXT, created_at INTEGER, updated_at INTEGER);",
    "CREATE TABLE user_identity_aliases (old_user_id TEXT PRIMARY KEY, user_id TEXT);",
    "CREATE TABLE user_profile_sections (user_id TEXT REFERENCES users(id), section_type TEXT, reference_id TEXT, position INTEGER, is_visible INTEGER, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(user_id, section_type, reference_id));",
    "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), created_at INTEGER, last_seen_at INTEGER, expires_at INTEGER);",
    "CREATE TABLE auth_attempt_windows (bucket_key TEXT PRIMARY KEY, window_start INTEGER, attempts INTEGER);",
    "CREATE TABLE user_security_questions (user_id TEXT PRIMARY KEY, question TEXT NOT NULL, answer_salt TEXT NOT NULL, answer_hash TEXT NOT NULL, answer_iterations INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);"
  ].join('\n'));

  const db = adapter(sqlite);
  const password = crypto.randomUUID();
  const securityQuestion = 'ما اسم أول مدرسة درست فيها؟';
  const securityAnswer = crypto.randomUUID();

  function request(body = {}, options = {}) {
    return onRequest({
      env: { DB: db },
      request: new Request('https://wany.test/api/' + (options.path ?? 'register'), {
        method: 'POST',
        headers: {
          Origin: options.origin ?? 'https://wany.test',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': options.ip ?? 'fixture',
        },
        body: JSON.stringify({
          username: 'reader1',
          password,
          confirmPassword: password,
          securityQuestion,
          securityAnswer,
          ...body,
        }),
      }),
    });
  }

  return { sqlite, db, password, securityQuestion, securityAnswer, request };
}

test('registration creates a private regular account with hashed password and security answer', async t => {
  const f = await fixture(t);
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

  const question = f.sqlite.prepare('SELECT * FROM user_security_questions WHERE user_id = ?').get(user.id);
  assert.equal(question.question, f.securityQuestion);
  assert.notEqual(question.answer_hash, f.securityAnswer);
  assert.ok(await verifySecurityAnswer(f.securityAnswer, question));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM user_profile_sections').get().n, 4);

  const login = await f.request({ username: 'reader1', password: f.password }, { path: 'login' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('registration requires username of at least three characters', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ username: 'ab' })).status, 400);
  assert.equal((await f.request({ username: 'abc' })).status, 201);
});

test('registration requires matching password confirmation', async t => {
  const f = await fixture(t);
  const response = await f.request({ confirmPassword: f.password + '-different' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'PASSWORD_MISMATCH');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('registration requires a security question and answer', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ securityQuestion: 'short' })).status, 400);
  assert.equal((await f.request({ securityAnswer: '' })).status, 400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('duplicate names are rejected without corrupting the existing account', async t => {
  const f = await fixture(t);
  assert.equal((await f.request()).status, 201);
  assert.equal((await f.request({ username: 'READER1' })).status, 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM user_security_questions').get().n, 1);
});

test('simultaneous duplicate usernames create only one account', async t => {
  const f = await fixture(t);
  const responses = await Promise.all([f.request(), f.request({ username: 'READER1' })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM user_security_questions').get().n, 1);
});

test('failed transactional setup leaves no partial account or security question', async t => {
  const f = await fixture(t);
  f.sqlite.exec("CREATE TRIGGER fail_setup BEFORE INSERT ON user_profile_sections BEGIN SELECT RAISE(ABORT, 'setup failed'); END;");
  assert.equal((await f.request()).status, 500);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM user_security_questions').get().n, 0);
  f.sqlite.exec('DROP TRIGGER fail_setup');
  assert.equal((await f.request()).status, 201);
});

test('registration rejects cross-site posts, invalid usernames and weak passwords, and throttles attempts', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({}, { origin: 'https://other.test' })).status, 403);
  assert.equal((await f.request({ username: '_cannot_login' })).status, 400);
  assert.equal((await f.request({ password: 'short', confirmPassword: 'short' })).status, 400);
  for (let i = 0; i < 7; i++) await f.request({ username: 'ab' });
  assert.equal((await f.request()).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});
