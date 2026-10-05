import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].js";

class FakeStatement {
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
    if (this.query.includes("SELECT value FROM schema_meta")) {
      return { value: "19" };
    }

    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      if (!this.db.authorized) return null;
      return {
        token_hash: "test-token-hash",
        user_id: this.db.user.id,
        expires_at: Date.now() + 60_000,
        last_seen_at: Date.now(),
        ...this.db.user,
      };
    }

    if (
      this.query.includes(
        "SELECT id, username, name, profile_visibility, avatar_id FROM users WHERE id = ?",
      )
    ) {
      return this.args[0] === this.db.user.id ? { ...this.db.user } : null;
    }

    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    if (this.query.includes("UPDATE users SET name = ?")) {
      const [name, , userId] = this.args;
      this.db.mutatedUserIds.push(userId);
      if (userId === this.db.user.id) this.db.user.name = name;
      return { meta: { changes: userId === this.db.user.id ? 1 : 0 } };
    }

    if (this.query.includes("UPDATE users SET profile_visibility = ?")) {
      const [visibility, , userId] = this.args;
      this.db.mutatedUserIds.push(userId);
      if (userId === this.db.user.id) this.db.user.profile_visibility = visibility;
      return { meta: { changes: userId === this.db.user.id ? 1 : 0 } };
    }

    return { meta: { changes: 1 } };
  }
}

class FakeDb {
  constructor({ authorized = true } = {}) {
    this.authorized = authorized;
    this.user = {
      id: "actor",
      username: "actor",
      name: "Actor",
      profile_visibility: "private",
      avatar_id: "one-piece:luffy",
    };
    this.mutatedUserIds = [];
  }

  prepare(query) {
    return new FakeStatement(this, query);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

async function call(db, path, body) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://wany.test",
  };
  if (db.authorized) headers.Cookie = "anytime_session=test-session";

  return onRequest({
    request: new Request("https://wany.test/api/" + path, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }),
    env: { DB: db },
  });
}

test("display name update is trimmed and bound to the authenticated user", async () => {
  const db = new FakeDb();
  const response = await call(db, "profile/name", {
    name: "  اسم جديد  ",
    userId: "victim",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(db.mutatedUserIds, ["actor"]);
  assert.equal(db.user.name, "اسم جديد");

  const { user } = await response.json();
  assert.equal(user.id, "actor");
  assert.equal(user.name, "اسم جديد");
  assert.equal(user.avatarId, "one-piece:luffy");
});

test("display name validation rejects empty, oversized and control-character values", async () => {
  for (const name of ["   ", "x".repeat(51), "bad\nname"]) {
    const db = new FakeDb();
    const response = await call(db, "profile/name", { name });
    assert.equal(response.status, 400);
    assert.deepEqual(db.mutatedUserIds, []);
  }
});

test("settings mutations reject an unauthenticated request", async () => {
  const db = new FakeDb({ authorized: false });
  const response = await call(db, "profile/name", { name: "Nope" });
  assert.equal(response.status, 401);
  assert.deepEqual(db.mutatedUserIds, []);
});

test("privacy update ignores a forged user id and updates only the session user", async () => {
  const db = new FakeDb();
  const response = await call(db, "profile/visibility", {
    visibility: "public",
    userId: "victim",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(db.mutatedUserIds, ["actor"]);
  assert.equal(db.user.profile_visibility, "public");
});

test("settings UI extends the existing account settings view and reuses AvatarPicker", async () => {
  const [profile, account, app, picker, css] = await Promise.all([
    readFile(new URL("../src/pages/Profile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AvatarPicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/phase9.css", import.meta.url), "utf8"),
  ]);

  assert.match(account, /tab=settings/);
  assert.doesNotMatch(app, /path="settings"/);
  assert.match(profile, /setDisplayName/);
  assert.match(profile, /AvatarPicker/);
  assert.match(profile, /setProfileVisibility/);
  assert.match(profile, /changePassword/);
  assert.match(profile, /signOut/);
  assert.match(profile, /autoComplete="current-password"/);
  assert.match(profile, /autoComplete="new-password"/);
  assert.match(profile, /جارٍ الحفظ/);
  assert.match(profile, /جارٍ التحديث/);
  assert.match(profile, /جارٍ تسجيل الخروج/);
  assert.doesNotMatch(picker, /type="file"|gravatar|camera/i);
  assert.match(css, /@media \(max-width: 759px\)/);
});

test("settings traffic is explicitly no-store on client and API responses", async () => {
  const [service, api] = await Promise.all([
    readFile(new URL("../src/services/userData.ts", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8"),
  ]);

  assert.match(service, /cache: "no-store"/);
  assert.match(api, /"Cache-Control": "no-store"/);
});

test("password change verifies the current password and invalidates other sessions", async () => {
  const source = await readFile(
    new URL("../functions/api/change-password.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /verifyPassword\(currentPassword, authRow\)/);
  const passwords = await readFile(new URL("../functions/_password.js", import.meta.url), "utf8");
  assert.match(passwords, /PBKDF2/);
  assert.match(passwords, /hash: "SHA-256"/);
  assert.match(
    source,
    /DELETE FROM sessions WHERE user_id = \? AND token_hash <> \?/,
  );
  assert.doesNotMatch(
    source,
    /console\.(?:log|info|debug)\([^)]*(?:currentPassword|newPassword)/,
  );
});

test("login delegates to the shared API handler that preserves avatar data", async () => {
  const login = await readFile(
    new URL("../functions/api/login.js", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../functions/api/[[path]].js", import.meta.url),
    "utf8",
  );
  const admin = await readFile(
    new URL("../functions/_admin.js", import.meta.url),
    "utf8",
  );

  assert.match(login, /handleApiRequest\(context\)/);
  assert.match(api, /profile_visibility, avatar_id, role, password_salt/);
  assert.match(admin, /avatarId: row\.avatar_id \?\? row\.avatarId \?\? null/);
});

