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
  assert.match(api, /SELECT user_id, badge_type FROM user_badges WHERE user_id IN/);
  assert.match(api, /attachServerBadges\(response, db\)/);
  assert.match(api, /node\.badgeType = granted\.get\(node\.id\) \?\? null/);
  assert.doesNotMatch(api, /username === "m"/);
  assert.match(api, /return await attachServerBadges/);
  assert.match(api, /function attachServerBadges/);
});

test("account UI renders badges only from server-provided field", async () => {
  for (const path of ["../src/components/ProfileOverview.tsx", "../src/pages/Profile.tsx", "../src/pages/Friends.tsx", "../src/components/ActivityFeed.tsx"]) {
    const src = await read(path);
    assert.match(src, /<AccountBadge badgeType=\{/);
    assert.doesNotMatch(src, /<AccountBadge username=/);
  }
});


test("ordinary account header and other users' profiles show D1 badge without entering edit mode", async () => {
  const src = await read("../src/components/ProfileOverview.tsx");
  const headers = [...src.matchAll(/<h1 dir="auto">\{user\?\.name \?\? "—"\} <AccountBadge badgeType=\{user\?\.badgeType\} \/><\/h1>/g)];
  assert.equal(headers.length, 2, "both editable and read-only headers must show the badge");
});
