import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const details = await readFile(
  new URL("../src/pages/SourceMangaDetails.tsx", import.meta.url),
  "utf8",
);

test("source details paginates large chapter lists instead of rendering every row", () => {
  assert.match(details, /const CHAPTERS_PER_PAGE = 100;/);
  assert.match(
    details,
    /const visibleChapters = orderedChapters\.slice\(\s*\(chapterPage - 1\) \* CHAPTERS_PER_PAGE,\s*chapterPage \* CHAPTERS_PER_PAGE,/,
  );
  assert.match(details, /<ChapterPagination[\s\S]*page=\{chapterPage\}[\s\S]*pages=\{chapterPageCount\}/);
  assert.match(details, /\{visibleChapters\.map\(\(chapter\) =>/);
});
