import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/0022_manhwa_avatars.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const picker = await readFile(new URL("../src/components/AvatarPicker.tsx", import.meta.url), "utf8");
const search = await readFile(new URL("../src/services/avatars.ts", import.meta.url), "utf8");

test("manhwa shelf adds exactly ten distinct works without altering the legacy ten-series schema", () => {
  const names = [...migration.matchAll(/\('(?:manhwa:[^']+|solo-leveling:jinwoo)','manhwa','([^']+)',\d+\)/g)].map((m) => m[1]);
  assert.equal(names.length, 10);
  assert.equal(new Set(names).size, 10);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS avatar_display_categories/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE users|DELETE FROM/);
});

test("new manhwa avatars are stored under existing FK-compatible series and have a distinct display group", () => {
  const newIds = [...migration.matchAll(/\('(manhwa:[^']+)','solo-leveling'/g)].map((m) => m[1]);
  assert.equal(newIds.length, 9);
  assert.equal(new Set(newIds).size, 9);
  assert.match(api, /id: "manhwa"/);
  assert.match(api, /name: "مانهوا"/);
  assert.match(api, /workTitle: row\.work_title/);
  assert.match(api, /if \(manhwaIds\.has\(row\.avatar_id\)/);
});

test("picker shows and searches by work title", () => {
  assert.match(picker, /avatar\.workTitle/);
  assert.match(search, /avatar\.workTitle/);
});
