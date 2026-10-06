import { createSourceFetcher } from "../functions/_source-transport.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterImageType, protectImageHeaders, isPublicImageUrl, readImageBody } from '../functions/_image-security.js';
import { onRequest } from '../functions/api/source/image.js';
import { onRequest as sourceRequest } from '../functions/api/source/[[path]].js';

test('active image documents are excluded, raster types normalized', () => {
  for (const type of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'text/html', 'image/unknown']) assert.equal(rasterImageType(type), null);
  assert.equal(rasterImageType('IMAGE/PNG; charset=binary'), 'image/png');
  const headers = protectImageHeaders(new Headers(), 'image/png');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Content-Security-Policy'), "sandbox; default-src 'none'; frame-ancestors 'none'");
});

test('image URLs reject private and alternate IP spellings and URL credentials', () => {
  for (const value of ['http://localhost/x', 'http://localhost./x', 'http://127.1/x', 'http://2130706433/x', 'http://0x7f000001/x', 'http://10.1.2.3/x', 'http://172.16.1.1/x', 'http://169.254.169.254/x', 'http://100.64.0.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[fe80::1]/x', 'http://[fd00::1]/x', 'http://host.internal/x', 'http://user:pass@example.com/x', 'https://example.com:1234/x']) assert.equal(isPublicImageUrl(value), false, value);
  assert.equal(isPublicImageUrl('https://cdn-stellarsaber.com/a.png'), true);
});

test('redirects to private targets are rejected before a second fetch', async () => {
  for (const target of ['http://127.0.0.1/x', 'http://[::ffff:10.0.0.1]/x', 'http://localhost./x']) {
    let calls = 0;
    await assert.rejects(createSourceFetcher({ fetcher: async (_, options) => {
      calls++; assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: target } });
    } })('https://cdn-stellarsaber.com/start'), /INVALID_SOURCE_HOST/);
    assert.equal(calls, 1);
  }
});

test('public relative redirects work, redirect loops have a fixed budget', async () => {
  const visited = [];
  const result = await createSourceFetcher({ fetcher: async url => {
    visited.push(url);
    return visited.length === 1 ? new Response(null, { status: 302, headers: { Location: '/end' } }) : new Response('image');
  } })('https://cdn-stellarsaber.com/start');
  assert.deepEqual(visited, ['https://cdn-stellarsaber.com/start', 'https://cdn-stellarsaber.com/end']);
  assert.equal(await result.text(), 'image');
  let calls = 0;
  await assert.rejects(createSourceFetcher({ fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: '/start' } }); } })('https://cdn-stellarsaber.com/start'), /SOURCE_REDIRECT_LIMIT/);
  assert.equal(calls, 5);
});

test('cover upload stream stops at the limit even without Content-Length', async () => {
  let canceled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4)); }, cancel() { canceled = true; } });
  await assert.rejects(readImageBody(new Request('https://example.com', { method: 'PUT', body, duplex: 'half' }), 5), /INVALID_COVER_SIZE/);
  assert.equal(canceled, true);
  assert.deepEqual([...await readImageBody(new Request('https://example.com', { method: 'PUT', body: new Uint8Array([1,2,3]) }), 5)], [1,2,3]);
});

const db = { prepare() { return { bind() { return this; }, async first() { return { user_id: 'test-user' }; } }; } };
test('authenticated proxy rejects attacker SVG and protects raster responses', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const request = new Request('https://wany.example/api/source/image?source=mangatime&url=https://cdn-stellarsaber.com/test', { headers: { Cookie: 'anytime_session=test-token' } });
  globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal((await onRequest({ request, env: { DB: db } })).status, 502);
  globalThis.fetch = async () => new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'image/png' } });
  const result = await onRequest({ request, env: { DB: db } });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('Content-Security-Policy'), /sandbox/);
  assert.match(result.headers.get('Cache-Control'), /^private,/);
});

const imageEntrypoints = [onRequest, sourceRequest];
function imageContext(path = '/api/source/image', target = 'https://cdn-stellarsaber.com/test', method = 'GET', database = db, authenticated = true) {
  return { env: { DB: database }, request: new Request(`https://wany.example${path}?source=teamx&url=${encodeURIComponent(target)}`, {
    method, headers: authenticated ? { Cookie: 'anytime_session=test-token' } : {},
  }) };
}

test('image route suffixes and unsupported methods never access D1 or upstream', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { assert.fail('rejected routes must not fetch'); };
  const forbiddenDb = { prepare() { assert.fail('rejected routes must not access D1'); } };
  for (const handler of imageEntrypoints) {
    for (const path of ['/api/source/image/anything', '/api/source/image/audit.svg', '/api/source/image//', '/api/source/image/%2fextra']) {
      assert.equal((await handler(imageContext(path, undefined, 'GET', forbiddenDb))).status, 404, path);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      assert.equal((await handler(imageContext('/api/source/image', undefined, method, forbiddenDb))).status, 405, method);
    }
  }
});

test('both image entrypoints require a session before any upstream request', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { assert.fail('unauthenticated image request must not fetch'); };
  for (const handler of imageEntrypoints) {
    assert.equal((await handler(imageContext('/api/source/image', undefined, 'GET', db, false))).status, 401);
  }
});

test('catchall delegates exact image routes without source schema initialization', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const bytes = new Uint8Array([1, 2, 3]);
  globalThis.fetch = async (_, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  };
  const sessionOnlyDb = { prepare(sql) {
    assert.match(sql, /^SELECT user_id FROM sessions /);
    return { bind() { return this; }, async first() { return { user_id: 'test-user' }; } };
  } };
  for (const handler of imageEntrypoints) {
    for (const path of ['/api/source/image', '/api/source/image/']) {
      const result = await handler(imageContext(path, undefined, 'GET', sessionOnlyDb));
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('Content-Type'), 'image/png');
      assert.match(result.headers.get('Content-Security-Policy'), /sandbox/);
      assert.match(result.headers.get('Cache-Control'), /^private,/);
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
    }
  }
});

test('catchall and direct image routes both reject active documents', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const type of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'text/html']) {
    globalThis.fetch = async () => new Response('<svg><script>/* fixture */</script></svg>', { headers: { 'Content-Type': type } });
    for (const handler of imageEntrypoints) assert.equal((await handler(imageContext())).status, 502, type);
  }
});

test('both image routes block mapped loopback and private destinations before fetch', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { assert.fail('private destination must not fetch'); };
  for (const target of ['http://[::ffff:127.0.0.1]/secret', 'http://127.1/secret', 'http://169.254.169.254/secret', 'http://host.internal/secret']) {
    for (const handler of imageEntrypoints) assert.equal((await handler(imageContext('/api/source/image', target))).status, 400, target);
  }
});

test('both image routes stop private redirects before fetching their destination', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const target of ['http://[::ffff:127.0.0.1]/secret', 'http://10.0.0.1/secret']) {
    for (const handler of imageEntrypoints) {
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, 'https://cdn-stellarsaber.com/test');
        assert.equal(options.redirect, 'manual');
        return new Response(null, { status: 302, headers: { Location: target } });
      };
      assert.equal((await handler(imageContext())).status, 502);
      assert.equal(calls, 1);
    }
  }
});
