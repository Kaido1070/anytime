import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSourceUrl } from '../functions/_source-egress.js';
import { createSourceFetcher } from '../functions/_source-transport.js';
import { onRequest as imageRequest } from '../functions/api/source/image.js';
import { onRequest as sourceRequest } from '../functions/api/source/[[path]].js';

const sourceUrls = [
  'https://mangatime.org/api/trpc/content.getChapters',
  'https://olympustaff.com/series/fixture/1',
  'https://3asq.online/manga/fixture',
  'https://starzmanga.com/manga/fixture',
  'https://www.xsano-manga.com/feeds/posts/default',
  'https://mangalik.net/manga/fixture',
  'https://azorafly.com/series/fixture',
  'https://storage.azorafly.com/fixture.png',
  'https://io.mangalik.net/fixture.webp',
  'https://starz.starzmanga.com/fixture.jpg',
  'https://cdn-stellarsaber.com/fixture.avif',
  'https://s4.anilist.co/fixture.png',
  'https://blogger.googleusercontent.com/fixture.png',
];
const hostileUrls = [
  'https://attacker.example.com/image.png',
  'https://mangatime.org.attacker.example/image.png',
  'https://attacker-mangatime.org/image.png',
  'https://evil.mangatime.org/image.png',
  'https://storage.azorafly.com.attacker.example/x',
  'https://mangatime.org./image.png',
  'https://mangatime.org@attacker.example.com/image.png',
  'https://attacker:password@mangatime.org/image.png',
  'https://8.8.8.8/image.png',
  'https://[2606:4700:4700::1111]/image.png',
  'http://mangatime.org/image.png',
  'https://mangatime.org:8443/image.png',
  'https://mangatime.org:80/image.png',
  'https://localhost/image.png',
  'https://169.254.169.254/image.png',
];

test('egress allows reviewed exact source and CDN destinations, never arbitrary DNS names', () => {
  for (const url of sourceUrls) assert.equal(isAllowedSourceUrl(url), true, url);
  for (const url of hostileUrls) assert.equal(isAllowedSourceUrl(url), false, url);
  assert.equal(isAllowedSourceUrl('https://MANGATIME.ORG/image.png'), true);
});

test('unknown domains and lookalikes cannot cause a DNS/fetch dispatch', async () => {
  const fetchSource = createSourceFetcher({ fetcher: () => assert.fail('unknown destination dispatched') });
  for (const url of hostileUrls) await assert.rejects(fetchSource(url), error => error.code === 'INVALID_SOURCE_HOST');
});

test('trusted initial URLs cannot redirect to unapproved domains or downgrade HTTPS', async () => {
  for (const next of hostileUrls) {
    let calls = 0;
    const fetchSource = createSourceFetcher({ fetcher: async () => {
      calls++; return new Response(null, { status: 302, headers: { Location: next } });
    } });
    await assert.rejects(fetchSource(sourceUrls[0]), error => error.code === 'INVALID_SOURCE_HOST');
    assert.equal(calls, 1);
  }
});

test('approved source-to-CDN redirect remains usable', async () => {
  let calls = 0;
  const fetchSource = createSourceFetcher({ fetcher: async () => ++calls === 1
    ? new Response(null, { status: 302, headers: { Location: sourceUrls[7] } })
    : new Response(new Uint8Array([1,2,3]), { headers: { 'Content-Type': 'image/png' } }) });
  const r = await fetchSource(sourceUrls[6]);
  assert.equal(r.url, sourceUrls[7]); assert.equal(calls, 2);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1,2,3]);
});

test('routing overrides cannot bypass an approved URL', async () => {
  const fetchSource = createSourceFetcher({ fetcher: () => assert.fail('routing override dispatched') });
  for (const options of [{ headers: { Host: 'internal.example' } }, { cf: { resolveOverride: 'internal.example' } }]) {
    await assert.rejects(fetchSource(sourceUrls[0], options), error => error.code === 'INVALID_SOURCE_ROUTING');
  }
});

const db = { prepare(sql) {
  assert.match(sql, /^SELECT user_id FROM sessions /);
  return { bind() { return this; }, async first() { return { user_id: 'fixture' }; } };
} };
test('both image entrypoints reject attacker-selected domains before upstream access', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = () => assert.fail('attacker domain fetched');
  for (const handler of [imageRequest, sourceRequest]) {
    const r = await handler({ env: { DB: db }, request: new Request('https://wany.site/api/source/image?source=mangatime&url=' + encodeURIComponent(hostileUrls[0]), { headers: { Cookie: 'anytime_session=fixture' } }) });
    assert.equal(r.status, 400); assert.equal((await r.json()).error, 'INVALID_IMAGE_HOST');
  }
});
