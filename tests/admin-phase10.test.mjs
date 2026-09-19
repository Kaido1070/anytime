import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAdminUser, isSocialUser } from "../functions/_admin.js";
import { onRequest as onAdminRequest } from "../functions/api/admin/[[path]].js";

test("role helpers keep admin outside the social layer", () => {
  assert.equal(isAdminUser({ role: "admin" }), true);
  assert.equal(isAdminUser({ role: "user" }), false);
  assert.equal(isSocialUser({ role: "user" }), true);
  assert.equal(isSocialUser({ role: "admin" }), false);
});

class AdminAuthStatement {
  constructor(db, query) {
    this.db = db;
    this.query = query;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      if (!this.db.role) return null;
      return {
        token_hash: "token-hash",
        expires_at: Date.now() + 60_000,
        id: "actor",
        username: "actor",
        name: "Actor",
        profile_visibility: "private",
        avatar_id: null,
        role: this.db.role,
      };
    }
    if (this.query.includes("FROM users WHERE id = ? AND role = 'user'")) return null;
    return { total: 0 };
  }
  async all() {
    if (this.query.includes("PRAGMA table_info(users)")) return { results: [{ name: "role" }] };
    return { results: [] };
  }
  async run() {
    return { meta: { changes: 0 } };
  }
}

class AdminAuthDb {
  constructor(role) {
    this.role = role;
  }
  prepare(query) {
    return new AdminAuthStatement(this, query);
  }
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

async function adminCall(role, path = "users") {
  const db = new AdminAuthDb(role);
  const request = new Request(`https://wany.test/api/admin/${path}`, {
    headers: { Cookie: "anytime_session=test-session" },
  });
  return onAdminRequest({ request, env: { DB: db } });
}

test("admin backend rejects normal users before any user detail is exposed", async () => {
  const response = await adminCall("user");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ADMIN_REQUIRED");
});

test("admin backend rejects unauthenticated access", async () => {
  const response = await adminCall(null);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "UNAUTHORIZED");
});

test("admin detail never treats the admin account as a social user target", async () => {
  const response = await adminCall("admin", "users/admin");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "USER_NOT_FOUND");
});

test("admin account provisioning is secret-driven and migration contains no credential", async () => {
  const [provision, migration] = await Promise.all([
    readFile(new URL("../functions/_admin_provision.js", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0009_admin.sql", import.meta.url), "utf8"),
  ]);

  assert.match(provision, /ADMIN_INITIAL_PASSWORD/);
  assert.match(provision, /length < 8/);
  assert.match(provision, /PBKDF2/);
  assert.match(provision, /role = 'admin'|role\)\s*VALUES/s);
  assert.match(provision, /UPDATE users[\s\S]*password_hash = \?[\s\S]*role = 'admin'/);
  assert.doesNotMatch(migration, /password_hash|password_salt|initial_password/i);
  assert.match(migration, /role IN \('user','admin'\)/);
  assert.match(migration, /admin_audit_log/);
});

test("normal APIs exclude admin from profiles, search, friends, requests and activity", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");

  assert.match(api, /ADMIN_SOCIAL_DISABLED/);
  assert.match(api, /FROM users WHERE id = \? AND role = 'user' LIMIT 1/);
  assert.match(api, /AND role = 'user'\s+AND \(/);
  assert.match(api, /JOIN users u ON u\.id = f\.friend_id[\s\S]*u\.role = 'user'/);
  assert.match(api, /JOIN users u ON u\.id = r\.requester_id[\s\S]*u\.role = 'user'/);
  assert.match(api, /u\.profile_visibility = 'public'[\s\S]*u\.role = 'user'/);
  assert.match(api, /Private profiles stop here: hidden data is never queried or serialized\./);
});

test("admin client is isolated to dedicated management routes and mobile layout", async () => {
  const [app, layout, page, css, service] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/layouts/AdminLayout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/phase10.css", import.meta.url), "utf8"),
    readFile(new URL("../src/services/userData.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /user\.role === "admin"/);
  assert.match(app, /path="\/admin"/);
  assert.match(app, /path="users\/:id"/);
  assert.doesNotMatch(layout, /استكشف|أصدقاء|نشاط أصدقاء/);
  assert.match(page, /highestReachedChapter/);
  assert.match(page, /lastReadChapter/);
  assert.match(page, /readingHistoryHasMore/);
  assert.match(service, /normalizedUsername === "admin" \? "admin-login" : "login"/);
  assert.match(css, /@media\(max-width:759px\)/);
  assert.match(css, /admin-users-table td::before/);
});

test("admin responses are no-store and public user serializer does not expose roles", async () => {
  const [adminApi, helpers] = await Promise.all([
    readFile(new URL("../functions/api/admin/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../functions/_admin.js", import.meta.url), "utf8"),
  ]);
  assert.match(adminApi, /Cache-Control": "private, no-store"/);
  const publicPart = helpers.slice(helpers.indexOf("export function publicUser"), helpers.indexOf("export function sessionUser"));
  assert.doesNotMatch(publicPart, /role:/);
  const sessionPart = helpers.slice(helpers.indexOf("export function sessionUser"), helpers.indexOf("export async function ensureAdminSchema"));
  assert.match(sessionPart, /role:/);
});


test("admin schema repair is non-destructive for existing user accounts", async () => {
  const helpers = await readFile(new URL("../functions/_admin.js", import.meta.url), "utf8");
  const provision = await readFile(new URL("../functions/_admin_provision.js", import.meta.url), "utf8");
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");

  assert.match(helpers, /PRAGMA table_info\(users\)/);
  assert.match(helpers, /ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'/);
  assert.doesNotMatch(helpers, /DROP TABLE users|DELETE FROM users|UPDATE users/);
  assert.doesNotMatch(helpers, /schema_version[\s\S]*return/);

  assert.match(api, /role TEXT NOT NULL DEFAULT 'user'[\s\S]*role IN \('user','admin'\)/);
  assert.doesNotMatch(provision, /DROP TABLE users|DELETE FROM users/);
  const updateStart = provision.indexOf("UPDATE users");
  const updateEnd = provision.indexOf(".run();", updateStart);
  const updateBlock = provision.slice(updateStart, updateEnd);
  assert.ok(updateStart >= 0, "Admin provisioning should update only the reserved Admin row");
  assert.match(updateBlock, /WHERE id = \?/);
  assert.match(provision, /WHERE username = \? COLLATE NOCASE LIMIT 1/);
});


test("admin provisioning never hijacks an ordinary existing account named Admin", async () => {
  const provision = await readFile(new URL("../functions/_admin_provision.js", import.meta.url), "utf8");
  assert.match(
    provision,
    /if \(existing\.id !== ADMIN_ID && existing\.role !== "admin"\)[\s\S]*Reserved Admin username belongs to an existing user account/,
  );
});
