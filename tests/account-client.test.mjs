import test from "node:test";
import assert from "node:assert/strict";
import { userDataService as service } from "../src/services/userData.ts";

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
