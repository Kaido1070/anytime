import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function harness() {
  const handlers = {};
  const calls = [];
  const cached = new Response('installed shell');
  const context = {
    self: {location: {origin: 'https://wany.site'}, addEventListener: (name, callback) => handlers[name] = callback},
    caches: {open: async () => ({match: async () => cached, put() {assert.fail('private response entered shell cache');}})},
    URL, Response,
    fetch: async (request, options) => {calls.push({request, options}); return new Response('network');},
  };
  vm.runInNewContext(source, context);
  const run = async (path, mode = 'cors') => {
    let response;
    handlers.fetch({request: {url: `https://wany.site${path}`, method: 'GET', mode}, respondWith: value => response = value, waitUntil() {}});
    return await response;
  };
  return {run, calls};
}
test('installed account shell and assets open without a network round trip', async () => {
  const {run, calls} = harness();
  assert.equal(await (await run('/profile', 'navigate')).text(), 'installed shell');
  await run('/assets/index-hash.js');
  assert.equal(calls.length, 0);
});
test('versioned R2 covers use private HTTP cache; account and progress bypass cache', async () => {
  const {run, calls} = harness();
  await run('/api/work-snapshots/cover?key=tx:story&v=1');
  assert.equal(calls[0].options.cache, 'default');
  for (const path of ['/api/session', '/api/data', '/api/progress', '/api/work-snapshots/cover?key=tx:story']) {
    await run(path);
    assert.equal(calls.at(-1).options.cache, 'no-store');
  }
});
