import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAccountIdentity } from "../src/services/accountIdentity.ts";
import { userDataService as service } from "../src/services/userData.ts";
import { readFile } from "node:fs/promises";

test("only a prior authenticated identity from the same user may fill an omitted badge", () => {
  const owner = { id: "owner-id", username: "m", name: "Mahdi", role: "user", badgeType: "crown", avatarId: null, profileVisibility: "private" };
  const partial = { id: owner.id, username: owner.username, name: "Updated", avatarId: null, profileVisibility: "public" };
  const merged = reconcileAccountIdentity(owner, partial);
  assert.equal(merged.badgeType, "crown");
  assert.equal(merged.role, "user");
  assert.equal(merged.name, "Updated");
  assert.equal(merged.profileVisibility, "public");

  assert.equal(reconcileAccountIdentity(owner, { ...partial, badgeType: null }).badgeType, null, "explicit server-side revocation clears the seal");
  assert.equal(reconcileAccountIdentity(owner, { ...partial, badgeType: "verified" }).badgeType, "verified", "explicit new grant replaces the old seal");
  assert.equal(reconcileAccountIdentity(owner, { ...partial, id: "other-id" }).badgeType, undefined, "different user IDs cannot inherit badges");
  assert.equal(reconcileAccountIdentity(owner, { ...partial, username: "h" }).badgeType, undefined, "different usernames cannot inherit badges");
  assert.equal(reconcileAccountIdentity(null, partial).badgeType, undefined, "no client-side badge grant");
});

test("opening settings and saving profile fields cannot erase an existing D1-granted crown", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let account = { id: "immutable-owner-id", username: "m", name: "Mahdi", role: "user", badgeType: "crown", avatarId: null, profileVisibility: "private" };
  let sessionBadge = "crown";
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input).replace(/^.*\/api\//, "");
    if (path === "login") return Response.json({ user: account });
    if (path === "session") {
      const responseUser = { ...account };
      if (sessionBadge === undefined) delete responseUser.badgeType;
      else responseUser.badgeType = sessionBadge;
      return Response.json({ user: responseUser });
    }
    if (path === "profile/avatar") {
      account = { ...account, avatarId: "avatar-test" };
      const { badgeType, role, ...publicUser } = account;
      return Response.json({ user: publicUser });
    }
    if (path === "profile/name") {
      account = { ...account, name: JSON.parse(init.body).name };
      const { badgeType, role, ...publicUser } = account;
      return Response.json({ user: publicUser });
    }
    if (path === "profile/visibility") {
      account = { ...account, profileVisibility: JSON.parse(init.body).visibility };
      const { badgeType, role, ...publicUser } = account;
      return Response.json({ user: publicUser });
    }
    if (path === "logout") return Response.json({ ok: true });
    throw new Error("Unexpected API route: " + path);
  };

  const signedIn = await service.signIn("m", "fixture");
  assert.equal(signedIn.badgeType, "crown");
  assert.equal((await service.setAvatar("avatar-test")).badgeType, "crown");
  assert.equal((await service.setDisplayName("New Name")).badgeType, "crown");
  const changed = await service.setProfileVisibility("public");
  assert.equal(changed.badgeType, "crown");
  assert.equal(changed.role, "user");

  sessionBadge = undefined;
  assert.equal((await service.getUser()).badgeType, "crown", "temporary missing badge in session does not erase the last authenticated grant");
  sessionBadge = null;
  assert.equal((await service.getUser()).badgeType, null, "the server can explicitly revoke the badge");

  await service.signOut();
});

test("returning from account settings revalidates the session identity", async () => {
  const account = await readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8");
  const hook = await readFile(new URL("../src/hooks/useLibrary.tsx", import.meta.url), "utf8");
  assert.match(account, /wasSettingsOpen\.current && !settingsOpen/);
  assert.match(account, /void refreshUser\(\)\.catch/);
  assert.match(hook, /const freshUser = await service\.getUser\(\)/);
  assert.match(hook, /reconcileAccountIdentity\(current, freshUser\)/);
});
