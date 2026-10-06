import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { onRequest } from '../functions/api/source/[[path]].js';

function fixture({ missing = false, transient = false, authorized = true } = {}) {
  const queries = [];
  const state = { missing, transient };
  const db = { prepare(sql) {
    queries.push(sql);
    assert.match(sql, /^SELECT\b/, 'request must never prepare DDL or bootstrap writes');
    return {
      bind() { return this; },
      async first() { return authorized ? { user_id: 'fixture' } : null; },
      async all() {
        if (state.missing) throw new Error('D1_ERROR: no such column: is_baseline');
        if (state.transient) throw new Error('temporary database unavailable');
        return { results: [] };
      },
    };
  } };
  const call = (path = 'status', method = 'GET') => onRequest({
    request: new Request('https://wany.site/api/source/' + path, { method, headers: { Cookie: 'anytime_session=fixture' } }),
    env: { DB: db },
  });
  return { queries, state, call };
}

test('source requests reject unsupported methods and unknown routes before database access', async () => {
  const f = fixture();
  assert.equal((await f.call('status', 'POST')).status, 405);
  assert.equal((await f.call('unknown')).status, 404);
  assert.equal((await f.call('health')).status, 200);
  assert.deepEqual(f.queries, []);
});

test('source readiness is read-only and shared across concurrent authenticated requests', async () => {
  const f = fixture();
  const responses = await Promise.all([f.call(), f.call()]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal(f.queries.filter(q => q.includes('LIMIT 0')).length, 3);
  assert.ok(f.queries.some(q => q.includes('genres_json')));
  assert.ok(f.queries.some(q => q.includes('is_baseline')));
});

test('missing source schema returns 503 without repair and retries after external migration', async () => {
  const f = fixture({ missing: true });
  const r = await f.call();
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'SOURCE_SCHEMA_NOT_READY');
  f.state.missing = false;
  assert.equal((await f.call()).status, 200);
  assert.equal(f.queries.filter(q => q.includes('LIMIT 0')).length, 6);
});

test('unauthorized source requests do not inspect source schema', async () => {
  const f = fixture({ authorized: false });
  assert.equal((await f.call()).status, 401);
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0], /FROM sessions/);
});

test('transient database failure is not mislabeled as a missing migration or permanently cached', async () => {
  const f = fixture({ transient: true });
  const r = await f.call();
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, 'SOURCE_ERROR');
  f.state.transient = false;
  assert.equal((await f.call()).status, 200);
});

test('source handler contains no schema mutation; offline migration supports empty, old and current schemas', async () => {
  const source = await readFile(new URL('../functions/api/source/[[path]].js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|PRAGMA\s+table_info|ensureSourceSchema/i);
  execFileSync('python3', [new URL('./source-schema-migration.py', import.meta.url).pathname], { stdio: 'pipe' });
});
