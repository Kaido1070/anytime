import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 6 keeps one accepted friendship system and adds canonical pending requests", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../migrations/0006_friend_requests.sql", import.meta.url),
    "utf8",
  );

  assert.match(api, /CREATE TABLE IF NOT EXISTS friend_requests/);
  assert.match(api, /PRIMARY KEY \(pair_low_id, pair_high_id\)/);
  assert.match(api, /canonicalFriendPair/);
  assert.match(migration, /idx_friend_requests_receiver/);
  assert.match(migration, /idx_friend_requests_requester/);
  assert.match(migration, /idx_friendships_friend/);
  assert.doesNotMatch(api, /CREATE TABLE IF NOT EXISTS accepted_friendships/);
});

test("Phase 6 exposes send, accept, reject, cancel, remove, relationship and search endpoints", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");

  assert.match(api, /path === "friends\/requests"/);
  assert.match(api, /path === "friends\/search"/);
  assert.match(api, /friends\\\/relationship/);
  assert.match(api, /\(accept\|reject\)/);
  assert.match(api, /requestCancelMatch/);
  assert.match(api, /request\.method === "DELETE" && friendMatch/);
  assert.match(api, /SELF_FRIEND_REQUEST/);
  assert.match(api, /NOT_REQUEST_RECEIVER/);
  assert.match(api, /NOT_REQUEST_SENDER/);
});

test("friend search prioritizes exact and prefix matches before contains matches", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");

  assert.match(api, /WHEN username = \? COLLATE NOCASE THEN 0/);
  assert.match(api, /WHEN name = \? COLLATE NOCASE THEN 1/);
  assert.match(api, /WHEN username LIKE \? ESCAPE/);
  assert.match(api, /WHEN name LIKE \? ESCAPE/);
  assert.match(api, /LIMIT \?/);
});

test("friends UI uses a dedicated hub with friends, requests and search tabs", async () => {
  const source = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /path="friends" element={<Friends \/>}/);
  assert.match(app, /path="friends\/:id" element={<FriendProfile \/>}/);
  assert.match(app, /import "\.\/phase6\.css"/);
  assert.match(source, /"friends" \| "requests" \| "search"/);
  assert.match(source, /friend-request-badge/);
  assert.match(source, /tab === "search"/);
  assert.match(source, /البحث عن مستخدم/);
  assert.match(source, /لم نجد مستخدمًا بهذا الاسم/);
});

test("friend cards expose identity only and profile actions cover all relationship states", async () => {
  const source = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /friend\.reading/);
  assert.doesNotMatch(source, /friend\.favorites/);
  assert.match(source, /relationship === "none"/);
  assert.match(source, /relationship === "pending_sent"/);
  assert.match(source, /relationship === "pending_received"/);
  assert.match(source, /✓ صديق/);
  assert.match(source, /هل تريد إزالة هذا المستخدم من الأصدقاء؟/);
});

test("private profile rendering remains favorites-only below the identity header", async () => {
  const source = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");

  assert.match(source, /const isPrivate = profile\.access === "private"/);
  assert.match(source, /isPrivate \? \(\s*<FavoritesSection/);
  assert.match(source, /relationship=\{relationship\}/);
  assert.doesNotMatch(source, /friends see private|friendAccess|friend_override/i);
});

test("Phase 6 mobile styles stack search and request actions without horizontal overflow", async () => {
  const css = await readFile(new URL("../src/phase6.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 759px\)/);
  assert.match(css, /\.friend-search-controls \{\s*grid-template-columns: 1fr/);
  assert.match(css, /\.friend-result-card,\s*\.friend-request-card \{\s*align-items: flex-start;\s*flex-direction: column/);
  assert.match(css, /min-width: 0/);
});
