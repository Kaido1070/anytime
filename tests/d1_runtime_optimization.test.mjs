import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("general API bootstraps D1 once per binding instead of on every request", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const requestHandler = api.slice(
    api.indexOf("export async function onRequest"),
    api.indexOf("async function route"),
  );
  assert.match(requestHandler, /await ensureApiRuntime\(db\)/);
  assert.doesNotMatch(requestHandler, /ensureDatabase\(db\)/);
  assert.doesNotMatch(requestHandler, /INSERT OR REPLACE INTO schema_meta/);
  assert.match(api, /const apiRuntimeReady = new WeakMap\(\)/);
  assert.match(api, /if \(version === "11"\) return/);
  assert.match(api, /schema_version', '11'/);
});

test("profile section GET is read-only after the one-time backfill", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const start = api.indexOf("async function getUserProfileSections");
  const end = api.indexOf("function normalizeProfileSectionInput", start);
  const getter = api.slice(start, end);
  assert.doesNotMatch(getter, /syncUserProfileSections/);
  assert.doesNotMatch(getter, /INSERT|UPDATE|DELETE/);
  assert.match(api, /INSERT OR IGNORE INTO user_profile_sections/);
});

test("progress route has one canonical implementation and suppresses no-op writes", async () => {
  const [api, progress] = await Promise.all([
    readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/progress.js", import.meta.url), "utf8"),
  ]);
  assert.match(progress, /handleApiRequest/);
  assert.doesNotMatch(progress, /CREATE TABLE|CREATE INDEX|user_library/);
  const start = api.indexOf('path === "progress"');
  const end = api.indexOf('path === "friends"', start);
  const block = api.slice(start, end);
  assert.match(block, /ABS\(reading_progress\.percent - excluded\.percent\) >= 0\.25/);
  assert.match(block, /user_state\.last_manga_id IS NOT excluded\.last_manga_id/);
  assert.match(block, /user_library\.last_read_chapter IS NOT excluded\.last_read_chapter/);
});

test("chapter open deduplicates rapid repeats while preserving later history", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const start = api.indexOf('path === "reading/open"');
  const end = api.indexOf('path === "reading/unread"', start);
  const block = api.slice(start, end);
  assert.match(api, /READING_OPEN_DEDUP_MS = 5 \* 60 \* 1000/);
  assert.match(block, /WHERE NOT EXISTS/);
  assert.match(block, /read_at >= \?/);
  assert.match(block, /user_library\.last_read_at < \?/);
});

test("legacy demo cleanup never deletes another user's rows and skips empty cleanup", async () => {
  const cleanup = await readFile(new URL("../functions/api/cleanup-demo.js", import.meta.url), "utf8");
  assert.match(cleanup, /SELECT 1 AS present/);
  assert.match(cleanup, /DELETE FROM favorites WHERE user_id = \?/);
  assert.match(cleanup, /DELETE FROM reading_progress WHERE user_id = \?/);
  assert.match(cleanup, /DELETE FROM user_library WHERE user_id = \?/);
  assert.match(cleanup, /DELETE FROM reading_history WHERE user_id = \?/);
  assert.match(cleanup, /WHERE user_id = \? AND last_manga_id IN/);
  assert.match(cleanup, /changed: false/);
});

test("source latest shares one handler and chapter observations only write changes", async () => {
  const [latest, source] = await Promise.all([
    readFile(new URL("../functions/api/source/latest.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/source/[[path]].js", import.meta.url), "utf8"),
  ]);
  assert.match(latest, /handleSourceRequest/);
  assert.doesNotMatch(latest, /CREATE TABLE|PRAGMA table_info|rememberItems/);
  assert.match(source, /const sourceSchemaReady = new WeakMap\(\)/);
  assert.match(source, /SELECT chapter_identity, chapter_number, first_seen_at, published_at, is_baseline/);
  assert.match(source, /if \(!numberChanged && !publicationChanged\) continue/);
  assert.match(source, /for \(let index = 0; index < identities\.length; index \+= 40\)/);
});

test("reader batches progress for 60 seconds and flushes meaningful progress on exit", async () => {
  const reader = await readFile(new URL("../src/pages/SourceReader.tsx", import.meta.url), "utf8");
  assert.match(reader, /PROGRESS_SAVE_DELAY_MS = 60 \* 1000/);
  assert.match(reader, /PROGRESS_MIN_DELTA = 3/);
  assert.match(reader, /pagehide/);
  assert.match(reader, /visibilityState === "hidden"/);
  assert.match(reader, /persist\(true\)/);
  assert.doesNotMatch(reader, /setTimeout\(persist, 1000\)/);
});

test("D1 optimization migration backfills profile sections and advances schema version once", async () => {
  const migration = await readFile(
    new URL("../migrations/0011_d1_runtime_optimization.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /idx_user_library_status/);
  assert.match(migration, /idx_reading_history_user_chapter/);
  assert.match(migration, /'continue_reading'/);
  assert.match(migration, /'favorites'/);
  assert.match(migration, /'my_activity'/);
  assert.match(migration, /'friends_activity'/);
  assert.match(migration, /'custom_list'/);
  assert.match(migration, /schema_version', '11'/);
});
