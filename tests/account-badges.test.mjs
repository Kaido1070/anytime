import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("badge display accepts only server-issued badgeType", async () => {
  const src = await read("../src/components/AccountBadge.tsx");
  assert.match(src, /badgeType === "crown" \|\| badgeType === "verified"/);
  assert.doesNotMatch(src, /username\s*===/);
  assert.match(src, /if \(!kind\) return null/);
  assert.match(src, /\/badges\/crown\.webp/);
  assert.match(src, /\/badges\/verified\.webp/);
  assert.doesNotMatch(src, /<svg\b|<path\b/);
  const css = await read("../src/styles.css");
  assert.match(css, /\.wany-account-badge img\s*\{/);
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


test("account and friend names render badge to the left, never between name and avatar", async () => {
  const profile = await read("../src/components/ProfileOverview.tsx");
  const friends = await read("../src/pages/Friends.tsx");
  const css = await read("../src/styles.css");
  assert.equal(profile.split('className="wany-badged-name"').length - 1, 2);
  assert.match(friends, /<h2><span className="wany-badged-name"><bdi>\{friend\.user\.name\}<\/bdi><AccountBadge badgeType=\{friend\.user\.badgeType\} \/><\/span><\/h2>/);
  assert.match(css, /\.wany-badged-name\s*\{[^}]*direction:\s*rtl/);
  assert.match(css, /\.wany-badged-name\s*\{[^}]*display:\s*inline-flex/);
  assert.doesNotMatch(friends, /friend\.user\.username === ["'](?:h|y)["']/);
});

test("profile identity has badge to the physical right of name and a distinct stats strip", async () => {
  const profile = await read("../src/components/ProfileOverview.tsx");
  const css = await read("../src/profileOverview.css");
  assert.match(profile, /<bdi>\{user\?\.name \?\? "—"\}<\/bdi><AccountBadge badgeType=\{user\?\.badgeType\} \/>/);
  assert.match(css, /\.profile-overview-header \.wany-badged-name\s*\{[^}]*direction:\s*ltr/);
  assert.match(css, /\.profile-overview-header \.profile-overview-identity\s*\{[^}]*direction:\s*ltr/);
  assert.match(css, /\.profile-stats-section \.profile-stats-grid\s*\{[^}]*border-radius:\s*0/);
  assert.match(css, /\.profile-stats-section \.profile-stats-grid\s*\{[^}]*background:\s*transparent/);
});

test("friends cards use left-aligned avatar and name with arrow on right", async () => {
  const css = await read("../src/profileOverview.css");
  assert.match(css, /\.friend-hub \.friends-list > \.friend-row\s*\{[^}]*direction:\s*ltr/);
  assert.match(css, /\.friend-hub \.friends-list > \.friend-row > \.user-avatar\s*\{[^}]*order:\s*0/);
  assert.match(css, /\.friend-hub \.friends-list > \.friend-row > div\s*\{[^}]*order:\s*1/);
  assert.match(css, /\.friend-hub \.friends-list > \.friend-row > span:last-child\s*\{[^}]*order:\s*2/);
});
