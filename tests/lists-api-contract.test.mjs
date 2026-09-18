import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 3 API keeps list writes scoped to the authenticated owner", async () => {
  const source = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");

  assert.match(
    source,
    /SELECT id FROM user_lists WHERE id = \? AND user_id = \? LIMIT 1/,
    "item mutations and reordering must verify list ownership",
  );
  assert.match(
    source,
    /DELETE FROM user_lists WHERE id = \? AND user_id = \?/,
    "list deletion must be owner-scoped",
  );
  assert.match(
    source,
    /UPDATE user_lists[\s\S]*WHERE id = \? AND user_id = \?/,
    "list edits must be owner-scoped",
  );
  assert.match(
    source,
    /PRIMARY KEY \(list_id, manga_id\)/,
    "the same work may appear in different lists but cannot be duplicated in one list",
  );
  assert.doesNotMatch(
    source,
    /DELETE FROM user_library WHERE[^\n]*list/,
    "list deletion must not delete user library records",
  );
  assert.doesNotMatch(
    source,
    /DELETE FROM reading_history WHERE[^\n]*list/,
    "list deletion must not delete reading history",
  );
});
