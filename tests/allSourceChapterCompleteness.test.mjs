import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../functions/api/source/[[path]].js", import.meta.url),
  "utf8",
);
const details = await readFile(
  new URL("../src/pages/SourceMangaDetails.tsx", import.meta.url),
  "utf8",
);
const readerPaths = await readFile(
  new URL("../src/services/readerPaths.ts", import.meta.url),
  "utf8",
);

test("all non-Team-X sources resolve chapter lists beyond the first visible batch", () => {
  assert.match(
    source,
    /async function mangaTimeAllChapters[\s\S]*for \(let page = 1; page <= 100; page \+= 1\)/,
    "MangaTime must follow paginated chapter API responses",
  );
  assert.match(
    source,
    /async function asqFetchSeriesChapters[\s\S]*fetchMadaraCompleteChapterHtml/,
    "3asq must use the complete Madara chapter archive",
  );
  assert.match(
    source,
    /async function starzFetchSeriesChapters[\s\S]*fetchMadaraCompleteChapterHtml/,
    "StarzManga must use the complete Madara chapter archive",
  );
  assert.match(
    source,
    /async function mangalikFetchSeriesChapters[\s\S]*fetchMadaraCompleteChapterHtml/,
    "MangaLik must use the complete Madara chapter archive",
  );
  assert.match(
    source,
    /async function xsanoFetchChapters[\s\S]*while \(start <= total\)/,
    "XSano must paginate its Blogger chapter feed to the reported end",
  );
  assert.match(
    source,
    /async function azoraCompleteChapterList[\s\S]*for \(const parameter of strategies\)/,
    "Azora must probe hidden chapter pagination/load-more pages",
  );
});

test("Madara chapter sources always probe beyond page one even without a visible marker", () => {
  const start = source.indexOf("async function fetchMadaraCompleteChapterHtml");
  const end = source.indexOf("async function asqFetchSeriesChapters", start);
  const block = source.slice(start, end);

  assert.match(block, /const first = await request\(endpoint\.toString\(\)\)/);
  assert.doesNotMatch(
    block,
    /if \(!madaraChapterListHasPagination\(first\)\) return first/,
  );
  assert.match(block, /for \(let page = 2; page <= 50; page \+= 1\)/);
});

test("Wany paginates large chapter lists locally after fetching the complete source list", () => {
  assert.match(details, /const CHAPTERS_PER_PAGE = 100;/);
  assert.match(details, /const visibleChapters = orderedChapters\.slice/);
  assert.match(details, /<ChapterPagination/);
});

test("non-Team-X chapter links preserve the exact source chapter URL", () => {
  assert.match(readerPaths, /if \(chapterUrl && item\.source !== "teamx"\) search\.set\("chapterUrl", chapterUrl\)/);
  assert.match(source, /const chapterUrl = String\(url\.searchParams\.get\("chapterUrl"\)/);
  assert.match(source, /await asqChapter\(db, item, number, chapterUrl\)/);
  assert.match(source, /await starzChapter\(db, item, number, chapterUrl\)/);
  assert.match(source, /await xsanoChapter\(db, item, number, chapterUrl\)/);
  assert.match(source, /await mangalikChapter\(db, item, number, chapterUrl\)/);
  assert.match(source, /await azoraChapter\(db, item, number, chapterUrl\)/);
});
