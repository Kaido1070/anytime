import test from "node:test";
import assert from "node:assert/strict";
import { userDataService as service } from "../src/services/userData.ts";
import ts from "typescript";
import { readFile } from "node:fs/promises";

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function mockStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: i => [...values.keys()][i], get length() { return values.size; } };
}
async function clientFixture(t) {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = mockStorage();
  globalThis.sessionStorage = mockStorage();
  const state = { owner: 'h', intercept: null, calls: [] };
  globalThis.fetch = async (url, init = {}) => {
    state.calls.push({ url, init });
    if (state.intercept) {
      const response = state.intercept(url, init);
      if (response !== undefined) return response;
    }
    if (url === '/api/login') {
      state.owner = JSON.parse(init.body).username;
      return Response.json({ user: { id: state.owner, username: state.owner, name: state.owner, role: 'user' } });
    }
    if (url === '/api/session') return Response.json({ user: { id: state.owner, username: state.owner, name: state.owner, role: 'user' } });
    if (url === '/api/data') return Response.json({ data: { version: 3, favorites: [`tx:${state.owner}`], library: [], progress: {}, completed: [], lastOpened: null } });
    if (url.startsWith('/api/friends?')) return Response.json({ friends: [], total: 0, hasMore: false });
    return Response.json({ ok: true });
  };
  await service.signOut();
  await service.signIn('h', 'fixture');
  t.after(async () => {
    state.intercept = null;
    await service.signOut();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return state;
}

test("login remains successful when optional cleanup fails; logout failure keeps account state", async () => {
  const savedFetch = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const values = new Map();
  const calls = [];
  let offline = false;
  let cleanupFails = true;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: i => [...values.keys()][i], get length() { return values.size; } };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (offline) throw new TypeError("Network unavailable");
    if (url === "/api/login") return Response.json({ user: { id: "12345678901234567890123456789012", username: "h", name: "H", role: "user" } });
    if (url === "/api/cleanup-demo") return cleanupFails ? Response.json({ error: "SERVER_ERROR" }, { status: 500 }) : Response.json({ ok: true });
    if (url === "/api/data") return Response.json({ data: { version: 3, favorites: [], library: [], progress: {}, completed: [], lastOpened: null } });
    return Response.json({ ok: true });
  };
  try {
    assert.equal((await service.signIn(" Ｈ ", "secret" )).username, "h");
    assert.equal(calls.length, 1, "login must not depend on cleanup");
    assert.equal(calls[0].body.username, "h");
    cleanupFails = false;
    const data = await service.getData();
    offline = true;
    await assert.rejects(service.signOut(), error => error.code === "NETWORK_ERROR");
    assert.deepEqual(await service.getData(), data, "failed logout retains the owner-scoped snapshot");
    await assert.rejects(service.signOut(true), error => error.code === "NETWORK_ERROR");
    offline = false;
    await service.recoverPassword(" h! ", "a-long-recovery-code", "newsecret");
    assert.equal(calls.at(-1).body.username, "h!", "recovery must not silently switch to another username");
    await service.signOut(true);
    offline = true;
    await assert.rejects(service.getData(), error => error.code === "NETWORK_ERROR");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
});

test('late library and friend responses cannot populate another account, even if transport ignores abort', async t => {
  const state = await clientFixture(t);
  await service.getData(); // complete optional cleanup first
  const data = deferred(), friends = deferred(), startedData = deferred(), startedFriends = deferred();
  let dataSignal;
  state.intercept = (url, init) => {
    if (url === '/api/data') { dataSignal = init.signal; startedData.resolve(); return data.promise; }
    if (url.startsWith('/api/friends?')) { startedFriends.resolve(); return friends.promise; }
  };
  const pendingData = service.getData(), pendingFriends = service.getFriends();
  const rejectedData = assert.rejects(pendingData, error => error.code === 'ACCOUNT_CHANGED');
  const rejectedFriends = assert.rejects(pendingFriends, error => error.code === 'ACCOUNT_CHANGED');
  await Promise.all([startedData.promise, startedFriends.promise]);
  await service.signOut();
  await service.signIn('y', 'fixture');
  assert.equal(dataSignal.aborted, true);
  state.intercept = null;
  await service.getData();
  data.resolve(Response.json({ data: { version: 3, favorites: ['tx:private-h'], library: [], progress: {}, completed: [], lastOpened: null } }));
  friends.resolve(Response.json({ friends: [{ id: 'private-h-friend', username: 'friend', name: 'Friend' }] }));
  await Promise.all([rejectedData, rejectedFriends]);
  assert.deepEqual(JSON.parse(localStorage.getItem('anytime:v3:data:y')).favorites, ['tx:y']);
  assert.equal(localStorage.getItem('anytime:v3:data:h'), null);
  assert.equal(localStorage.getItem('anytime:v3:friends:y'), null);
});

test('stale network errors never use the next account offline snapshot', async t => {
  const state = await clientFixture(t);
  await service.getData();
  const delayed = deferred(), started = deferred();
  state.intercept = url => { if (url === '/api/data') { started.resolve(); return delayed.promise; } };
  const rejected = assert.rejects(service.getData(), error => error.code === 'ACCOUNT_CHANGED');
  await started.promise;
  await service.signIn('y', 'fixture');
  state.intercept = null;
  await service.getData();
  delayed.reject(new TypeError('old request offline'));
  await rejected;
});

test('logout removes private caches and the same-account re-login still rejects old requests', async t => {
  const state = await clientFixture(t);
  await service.getData();
  await service.getFriends();
  localStorage.setItem('anytime:v2:data:other', 'historical-private-data');
  localStorage.setItem('anytime:v1:library', 'legacy-private-data');
  localStorage.setItem('anytime:session', 'legacy-session');
  sessionStorage.setItem('wany:fyp:h:old', 'private-taste');
  localStorage.setItem('unrelated-preference', 'keep');
  const delayed = deferred(), started = deferred();
  state.intercept = url => { if (url === '/api/data') { started.resolve(); return delayed.promise; } };
  const rejected = assert.rejects(service.getData(), error => error.code === 'ACCOUNT_CHANGED');
  await started.promise;
  await service.signOut();
  for (const key of ['anytime:v3:data:h', 'anytime:v3:friends:h', 'anytime:v2:data:other', 'anytime:v1:library', 'anytime:session']) assert.equal(localStorage.getItem(key), null);
  assert.equal(sessionStorage.getItem('wany:fyp:h:old'), null);
  assert.equal(localStorage.getItem('unrelated-preference'), 'keep');
  await service.signIn('h', 'fixture');
  delayed.resolve(Response.json({ data: { favorites: ['tx:old-session'] } }));
  await rejected;
});

test('a delayed cleanup cannot launch a data request after switching accounts', async t => {
  const state = await clientFixture(t);
  const delayed = deferred(), started = deferred();
  state.intercept = url => { if (url === '/api/cleanup-demo') { started.resolve(); return delayed.promise; } };
  const rejected = assert.rejects(service.getData(), error => error.code === 'ACCOUNT_CHANGED');
  await started.promise;
  await service.signIn('y', 'fixture');
  delayed.resolve(Response.json({ ok: true }));
  await rejected;
  assert.equal(state.calls.filter(call => call.url === '/api/data').length, 0);
});

test('authentication calls are serialized so logout cannot overtake a pending login', async t => {
  const state = await clientFixture(t);
  const delayed = deferred(), started = deferred();
  const order = [];
  state.intercept = url => {
    if (url === '/api/login') { order.push('login'); started.resolve(); return delayed.promise; }
    if (url === '/api/logout') order.push('logout');
  };
  const login = service.signIn('y', 'fixture');
  await started.promise;
  const logout = service.signOut();
  await Promise.resolve();
  assert.deepEqual(order, ['login']);
  delayed.resolve(Response.json({ user: { id: 'y', username: 'y', name: 'Y', role: 'user' } }));
  await Promise.all([login, logout]);
  assert.deepEqual(order, ['login', 'logout']);
  assert.equal(service.captureAccountScope(), null);
});

test('confirmed session restores only its own v3 snapshot and never reuses historical v2 data', async t => {
  const state = await clientFixture(t);
  await service.signOut();
  const snapshot = { version: 3, favorites: ['tx:restored'], library: [], progress: {}, completed: [], lastOpened: null };
  localStorage.setItem('anytime:v3:data:h', JSON.stringify(snapshot));
  localStorage.setItem('anytime:v3:data:y', 'other-private-data');
  localStorage.setItem('anytime:v2:data:h', 'potentially-misassigned-data');
  assert.equal((await service.getUser()).id, 'h');
  assert.equal(localStorage.getItem('anytime:v3:data:y'), null);
  assert.equal(localStorage.getItem('anytime:v2:data:h'), null);
  state.intercept = url => {
    if (url === '/api/data' || url === '/api/cleanup-demo') return Promise.reject(new TypeError('offline'));
  };
  assert.deepEqual((await service.getData()).favorites, ['tx:restored']);
});

test('snapshot cover jobs stay with their starting session and do not deduplicate across accounts', async t => {
  const state = await clientFixture(t);
  // Execute the real TS job orchestration with only title/URL adapters stubbed.
  const source = await readFile(new URL('../src/services/workSnapshots.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace(/^import .*;\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const harness = `const {userDataService, sourceService, sourceDisplayTitle} = globalThis.__snapshotAuditFixture;\n${code}`;
  globalThis.__snapshotAuditFixture = { userDataService: service, sourceService: { imageUrl: () => '/audit-cover' }, sourceDisplayTitle: item => item.title };
  t.after(() => { delete globalThis.__snapshotAuditFixture; });
  const { saveWorkSnapshot } = await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'));
  const cover = deferred(), started = deferred();
  let writes = 0;
  state.intercept = url => {
    if (url === '/api/work-snapshots') { writes++; return Response.json({ ok: true, needsCover: writes === 1 }); }
    if (url === '/audit-cover') { started.resolve(); return cover.promise; }
  };
  const item = { key: 'tx:shared', title: 'Story', source: 'teamx', url: 'https://example.com/story', cover: 'https://example.com/cover' };
  const hJob = saveWorkSnapshot(item);
  await started.promise;
  await service.signIn('y', 'fixture');
  const yJob = saveWorkSnapshot(item);
  assert.notEqual(hJob, yJob);
  cover.resolve(new Response('image', { headers: { 'Content-Type': 'image/png' } }));
  await Promise.all([hJob, yJob]);
  assert.equal(writes, 2);
  assert.equal(state.calls.filter(call => String(call.url).startsWith('/api/work-snapshots/cover')).length, 0);
  // A job within the unchanged account must still upload normally.
  state.intercept = url => {
    if (url === '/api/work-snapshots') return Response.json({ ok: true, needsCover: true });
    if (url === '/audit-cover') return new Response('image', { headers: { 'Content-Type': 'image/png' } });
  };
  await saveWorkSnapshot(item, 1);
  assert.equal(state.calls.filter(call => String(call.url).startsWith('/api/work-snapshots/cover')).length, 1);
});

test('another tab account change invalidates pending work and clears private data before reload', async t => {
  const originalWindow = globalThis.window;
  let listener, reloads = 0;
  globalThis.window = { addEventListener: (name, callback) => { if (name === 'storage') listener = callback; }, location: { reload: () => reloads++ } };
  t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
  await clientFixture(t);
  await service.getData();
  const scope = service.captureAccountScope();
  listener({ key: 'unrelated' });
  assert.equal(scope.isCurrent(), true);
  listener({ key: 'wany:account-change' });
  assert.equal(scope.isCurrent(), false);
  assert.equal(scope.signal.aborted, true);
  assert.equal(localStorage.getItem('anytime:v3:data:h'), null);
  assert.equal(reloads, 1);
});

test("account home caches progress and R2 metadata synchronously, scoped to the signed-in user", async t => {
  const state = await clientFixture(t);
  const next = {version: 3, favorites: ['tx:story'], library: [{mangaId: 'tx:story', status: 'reading', lastReadChapter: 58.1, highestReachedChapter: 58.1, lastReadAt: 100}], progress: {}, completed: [], lastOpened: {mangaId: 'tx:story', chapter: 58.1}};
  service.cacheData(next);
  const before = state.calls.length;
  assert.equal(service.getCachedData().lastOpened.chapter, 58.1);
  assert.equal(state.calls.length, before, 'cached first paint must not wait for a request');
  state.intercept = url => url.startsWith('/api/work-snapshots?') ? Response.json({snapshots: [{mangaId: 'tx:story', title: 'Story', coverUrl: '/api/work-snapshots/cover?key=tx%3Astory&v=1'}]}) : undefined;
  await service.getWorkSnapshots(['tx:story']);
  assert.match(service.getCachedWorkSnapshots(['tx:story'])[0].coverUrl, /^\/api\/work-snapshots\/cover/);
  state.intercept = null;
  await service.signIn('y', 'fixture');
  assert.equal(service.getCachedData(), null);
  assert.deepEqual(service.getCachedWorkSnapshots(['tx:story']), []);
  assert.equal(globalThis.localStorage.getItem('anytime:v3:works:h'), null);
});
