import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterImageType, protectImageHeaders, isPublicImageUrl, fetchPublicImage, readImageBody } from '../functions/_image-security.js';
import { onRequest } from '../functions/api/source/image.js';

test('active image documents are excluded, raster types normalized', () => {
  for (const type of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'text/html', 'image/unknown']) assert.equal(rasterImageType(type), null);
  assert.equal(rasterImageType('IMAGE/PNG; charset=binary'), 'image/png');
  const headers = protectImageHeaders(new Headers(), 'image/png');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Content-Security-Policy'), "sandbox; default-src 'none'; frame-ancestors 'none'");
});

test('image URLs reject private and alternate IP spellings and URL credentials', () => {
  for (const value of ['http://localhost/x', 'http://localhost./x', 'http://127.1/x', 'http://2130706433/x', 'http://0x7f000001/x', 'http://10.1.2.3/x', 'http://172.16.1.1/x', 'http://169.254.169.254/x', 'http://100.64.0.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[fe80::1]/x', 'http://[fd00::1]/x', 'http://host.internal/x', 'http://user:pass@example.com/x', 'https://example.com:1234/x']) assert.equal(isPublicImageUrl(value), false, value);
  assert.equal(isPublicImageUrl('https://cdn.example.com/a.png'), true);
});

test('redirects to private targets are rejected before a second fetch', async () => {
  for (const target of ['http://127.0.0.1/x', 'http://[::ffff:10.0.0.1]/x', 'http://localhost./x']) {
    let calls = 0;
    await assert.rejects(fetchPublicImage('https://cdn.example.com/start', {}, async (_, options) => {
      calls++; assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: target } });
    }), /INVALID_IMAGE_HOST/);
    assert.equal(calls, 1);
  }
});

test('public relative redirects work, redirect loops have a fixed budget', async () => {
  const visited = [];
  const result = await fetchPublicImage('https://cdn.example.com/start', {}, async url => {
    visited.push(url);
    return visited.length === 1 ? new Response(null, { status: 302, headers: { Location: '/end' } }) : new Response('image');
  });
  assert.deepEqual(visited, ['https://cdn.example.com/start', 'https://cdn.example.com/end']);
  assert.equal(await result.text(), 'image');
  let calls = 0;
  await assert.rejects(fetchPublicImage('https://cdn.example.com/start', {}, async () => { calls++; return new Response(null, { status: 302, headers: { Location: '/start' } }); }), /INVALID_IMAGE_REDIRECT/);
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
  const request = new Request('https://wany.example/api/source/image?source=mangatime&url=https://cdn.example.com/test', { headers: { Cookie: 'anytime_session=test-token' } });
  globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal((await onRequest({ request, env: { DB: db } })).status, 502);
  globalThis.fetch = async () => new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'image/png' } });
  const result = await onRequest({ request, env: { DB: db } });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('Content-Security-Policy'), /sandbox/);
  assert.match(result.headers.get('Cache-Control'), /^private,/);
});
