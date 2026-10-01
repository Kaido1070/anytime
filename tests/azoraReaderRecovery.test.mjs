import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../functions/api/source/[[path]].js", import.meta.url),
  "utf8",
);

test("Azora reader falls back to the direct chapter route when series hydration fails", () => {
  assert.match(
    source,
    /try\s*{\s*series = await azoraSeries\(db, item\);\s*}\s*catch \(error\)/,
  );
  assert.match(
    source,
    /const directChapterUrl =\s*seriesBase \+ "\/chapter-" \+ encodeURIComponent\(String\(number\)\)/,
  );
  assert.match(
    source,
    /if \(!pages\.length && sourceChapterUrl !== directChapterUrl\)/,
  );
});
