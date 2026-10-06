import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSourceFetcher } from '../functions/_source-transport.js';
import { onRequest } from '../functions/api/source/image.js';
import { onRequestGet as coverRequest } from '../functions/api/source/cover.js';
import { __test } from '../functions/api/source/[[path]].js';
import { __test as chapterTest } from '../functions/api/source/chapter.js';
const publicUrl = 'https://cdn-stellarsaber.com/start';
const code = expected => error => error.code === expected;

function stream(size = 4) {
  const state = { cancelled: false };
  state.body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(size)); }, cancel() { state.cancelled = true; } });
  return state;
}

test('transport rejects private initial and redirect targets before dispatch', async () => {
  let calls = 0;
  const fetchSource = createSourceFetcher({ fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://[::ffff:127.0.0.1]/x' } }); } });
  await assert.rejects(fetchSource('http://169.254.169.254/x'), code('INVALID_SOURCE_HOST'));
  assert.equal(calls, 0);
  await assert.rejects(fetchSource(publicUrl), code('INVALID_SOURCE_HOST'));
  assert.equal(calls, 1);
});

test('relative redirects preserve resolved URL; loops stop at four hops', async () => {
  const visits = [];
  const fetchSource = createSourceFetcher({ fetcher: async (url, opts) => {
    visits.push(url); assert.equal(opts.redirect, 'manual');
    return visits.length === 1 ? new Response(null, { status: 302, headers: { Location: '/final' } }) : new Response('normal');
  } });
  const response = await fetchSource(publicUrl);
  assert.equal(response.url, 'https://cdn-stellarsaber.com/final');
  assert.equal(await response.text(), 'normal');
  let calls = 0;
  const loop = createSourceFetcher({ fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: '/start' } }); } });
  await assert.rejects(loop(publicUrl), code('SOURCE_REDIRECT_LIMIT'));
  assert.equal(calls, 5);
});

test('redirects strip credentials and correctly convert POST while refusing cross-origin body replay', async () => {
  const calls = [];
  const fetchSource = createSourceFetcher({ fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://storage.azorafly.com/end' } }) : new Response('ok');
  } });
  await fetchSource(publicUrl, { method: 'POST', body: 'fixture', headers: { Authorization: 'synthetic', Cookie: 'synthetic', 'Content-Type': 'text/plain' } });
  assert.equal(calls[1].method, 'GET'); assert.equal(calls[1].body, undefined);
  for (const key of ['authorization', 'cookie', 'content-type']) assert.equal(new Headers(calls[1].headers).has(key), false);
  const unsafe = createSourceFetcher({ fetcher: async () => new Response(null, { status: 307, headers: { Location: 'https://storage.azorafly.com/end' } }) });
  await assert.rejects(unsafe(publicUrl, { method: 'POST', body: 'fixture' }), code('SOURCE_CROSS_ORIGIN_BODY'));
});

test('declared and chunked large bodies are cancelled before unlimited buffering', async () => {
  for (const headers of [{ 'Content-Length': '99' }, {}, { 'Content-Length': '1' }]) {
    const s = stream();
    const fetchSource = createSourceFetcher({ maxBodyBytes: 5, fetcher: async () => new Response(s.body, { headers }) });
    await assert.rejects(fetchSource(publicUrl), code('SOURCE_BODY_LIMIT'));
    assert.equal(s.cancelled, true);
  }
});

test('empty-chunk streams have a finite processing budget', async () => {
  const s = stream(0);
  const fetchSource = createSourceFetcher({ fetcher: async () => new Response(s.body) });
  await assert.rejects(fetchSource(publicUrl), code('SOURCE_CHUNK_LIMIT'));
  assert.equal(s.cancelled, true);
});

test('byte and request budgets include retries and redirects and are isolated per instance', async () => {
  const bytes = createSourceFetcher({ maxTotalBytes: 5, fetcher: async () => new Response('abc') });
  assert.equal(await (await bytes(publicUrl)).text(), 'abc');
  await assert.rejects(bytes(publicUrl), code('SOURCE_BODY_LIMIT'));
  let calls = 0;
  const requests = createSourceFetcher({ maxRequests: 2, fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: '/again' } }); } });
  await assert.rejects(requests(publicUrl), code('SOURCE_REQUEST_LIMIT'));
  assert.equal(calls, 2);
  assert.equal(await (await createSourceFetcher({ fetcher: async () => new Response('fresh') })(publicUrl)).text(), 'fresh');
});

test('timeouts cover stalled headers and stalled bodies even when transport ignores abort', async () => {
  const headers = createSourceFetcher({ timeoutMs: 20, fetcher: () => new Promise(() => {}) });
  await assert.rejects(headers(publicUrl), code('SOURCE_TIMEOUT'));
  let cancelled = false;
  const body = createSourceFetcher({ timeoutMs: 20, fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await assert.rejects(body(publicUrl), code('SOURCE_TIMEOUT'));
  assert.equal(cancelled, true);
});

test('concurrency, queued abort and overall deadline are bounded', async () => {
  let active = 0, peak = 0;
  const fetchSource = createSourceFetcher({ concurrency: 2, fetcher: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return new Response('ok');
  } });
  await Promise.all(Array.from({ length: 6 }, () => fetchSource(publicUrl)));
  assert.equal(peak, 2);
  const expired = createSourceFetcher({ deadlineMs: 0, fetcher: () => assert.fail('expired request dispatched') });
  await assert.rejects(expired(publicUrl), code('SOURCE_DEADLINE'));
  let release;
  const queued = createSourceFetcher({ concurrency: 1, fetcher: async () => { await new Promise(resolve => { release = resolve; }); return new Response('ok'); } });
  const first = queued(publicUrl);
  await new Promise(resolve => setTimeout(resolve, 0));
  const abort = new AbortController();
  const second = queued(publicUrl, { signal: abort.signal });
  const rejected = assert.rejects(second, /fixture abort/);
  abort.abort(new Error('fixture abort'));
  await rejected; release(); await first;
});

const db = { prepare(sql) { return { bind() { return this; }, async first() {
  return sql.includes('FROM sessions') ? { user_id: 'fixture' } : { source: 'azora', source_key: 'az:fixture', slug: 'fixture', url: 'https://azorafly.com/series/fixture', cover_url: 'https://cdn-stellarsaber.com/stored.png' };
}, async run() { return {}; } }; } };

test('real image route refuses oversized response and preserves raster headers and ordinary bytes', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const context = { env: { DB: db }, request: new Request('https://wany.site/api/source/image?source=teamx&url='+encodeURIComponent(publicUrl), { headers: { Cookie: 'anytime_session=fixture' } }) };
  globalThis.fetch = async () => new Response('x', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(17 * 1024 * 1024) } });
  assert.equal((await onRequest(context)).status, 502);
  globalThis.fetch = async () => new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'image/png' } });
  const response = await onRequest(context);
  assert.equal(response.status, 200); assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1,2,3]);
});

test('real cover resolver blocks private redirects and retains stored-cover fallback', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/x' } }); };
  const response = await coverRequest({ env: { DB: db }, request: new Request('https://wany.site/api/source/cover?key=az:fixture', { headers: { Cookie: 'anytime_session=fixture' } }) });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).covers.includes('https://cdn-stellarsaber.com/stored.png'));
  assert.equal(calls, 1);
});

test('source transport is used by reader JSON paths and request-owned closures', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (_, options) => { calls++; assert.equal(options.redirect, 'manual'); return Response.json({ result: { data: { json: { title: 'normal' } } } }); };
  assert.equal((await __test.mangaTimeTrpc('content.getSeriesBySlug', { slug: 'fixture' })).title, 'normal');
  assert.equal(calls, 1);
  for (const path of ['[[path]].js', 'cover.js']) {
    const source = await readFile(new URL('../functions/api/source/' + path, import.meta.url), 'utf8');
    assert.match(source, /const fetch = (?:sharedFetcher \|\| )?createSourceFetcher\(/);
    assert.match(source, /return create(?:SourceHandler\(context.request.signal, context.sourceFetcher\)\.onRequest|CoverHandler\(context.request.signal\))/);
  }
});

test('parent request abort cancels body loading and is shared by subrequests', async () => {
  const parent = new AbortController(); let started;
  const ready = new Promise(resolve => { started = resolve; });
  let cancelled = false;
  const fetchSource = createSourceFetcher({ requestSignal: parent.signal, fetcher: async () => {
    started(); return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  const rejected = assert.rejects(fetchSource(publicUrl), /parent cancelled/);
  await ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  parent.abort(new Error('parent cancelled'));
  await rejected; assert.equal(cancelled, true);
  await assert.rejects(fetchSource(publicUrl), /parent cancelled/);
});

test('all subrequests share the elapsed request deadline, not just individual fetch timeouts', async () => {
  const fetchSource = createSourceFetcher({ deadlineMs: 20, timeoutMs: 1000, fetcher: async () => new Response('ok') });
  assert.equal(await (await fetchSource(publicUrl)).text(), 'ok');
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(fetchSource(publicUrl), code('SOURCE_DEADLINE'));
});

test('Team-X banner verification has bounded fanout and retains unverified chapter pages', async () => {
  const pages = Array.from({ length: 80 }, (_, index) => ({ url: 'https://cdn-stellarsaber.com/fanout-' + index + '.png' }));
  let active = 0, peak = 0, calls = 0;
  const result = await chapterTest.filterKnownTeamXBanners(pages, 'https://olympustaff.com/series/fixture/1', async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    throw new Error('verification unavailable');
  });
  assert.equal(calls, 64); assert.equal(peak, 4); assert.deepEqual(result, pages);
  const source = await readFile(new URL('../functions/api/source/chapter.js', import.meta.url), 'utf8');
  assert.match(source, /handleSourceRequest\(\{ \.\.\.context, sourceFetcher: fetchSource \}\)/);
  assert.doesNotMatch(source, /\bfetch\(/);
});
