import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 4 profile sections are persisted per authenticated owner without duplicating list data", async () => {
  const source = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const schema = await readFile(new URL("../migrations/0004_user_profile_sections.sql", import.meta.url), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_profile_sections/);
  assert.match(schema, /PRIMARY KEY \(user_id, section_type, reference_id\)/);
  assert.match(
    source,
    /SELECT id FROM user_lists WHERE user_id = \? AND id IN/,
    "custom-list section references must be validated against the session owner",
  );
  assert.match(
    source,
    /ROW_NUMBER\(\) OVER \(PARTITION BY i\.list_id/,
    "custom-list previews must be fetched in one bounded query instead of N+1 queries",
  );
  assert.match(
    source,
    /DELETE FROM user_profile_sections[\s\S]*reference_id = \?[^\n]*custom_list/,
    "deleting a list must remove its presentation reference",
  );
  assert.doesNotMatch(
    source,
    /CREATE TABLE[^\n]*profile[^\n]*manga_id/,
    "profile sections must not copy works into a second content table",
  );
});

test("Phase 4 exposes only current system sections and does not add upcoming releases", async () => {
  const source = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  assert.match(source, /continue_reading/);
  assert.match(source, /favorites/);
  assert.doesNotMatch(source, /upcoming_release|release_countdown|next_release_at/i);
});

