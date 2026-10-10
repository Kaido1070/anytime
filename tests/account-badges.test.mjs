import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("badge display accepts only server-issued badgeType", async () => {
  const src = await read("../src/components/AccountBadge.tsx");
  assert.match(src, /badgeType === "crown" \|\| badgeType === "verified"/);
  assert.doesNotMatch(src, /username\s*===/);
  assert.match(src, /if \(!kind\) return null/);
  assert.match(src, /var\(--accent/);
});

test("badge authority is sourced from D1 on login, session, profile and social APIs", async () => {
  const api = await read("../functions/api/[[path]].js");
  const admin = await read("../functions/_admin.js");
  assert.match(api, /FROM user_badges WHERE user_id =/);
  assert.match(api, /badgeType: row\.badge_type/);
  assert.match(admin, /badgeType: row\.badge_type/);
  assert.match(api, /AS badge_type[\s\S]*FROM sessions/);
  assert.match(api, /AS badge_type[\s\S]*FROM friend_requests/);
});

test("account UI renders badges only from server-provided field", async () => {
  for (const path of ["../src/components/ProfileOverview.tsx", "../src/pages/Profile.tsx", "../src/pages/Friends.tsx", "../src/components/ActivityFeed.tsx"]) {
    const src = await read(path);
    assert.match(src, /<AccountBadge badgeType=\{/);
    assert.doesNotMatch(src, /<AccountBadge username=/);
  }
});
