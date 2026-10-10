import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { __test } from "../functions/api/source/[[path]].js";
import { readerChapterWindow } from "../src/services/readerNavigation.ts";

const series = "https://olympustaff.com/series/god-of-martial-arts";

test("Team-X extracts accurate fractional neighbors from one chapter page", () => {
  const html = `
    <div class="image_list">
      <img src="https://cdn.example.com/chapter/114-3-1.webp">
      <img src="https://cdn.example.com/chapter/114-3-2.webp">
    </div>
    <a href="${series}/114.2"><span>الفصل السابق</span></a>
    <a href="${series}/115.1"><span>الفصل التالي</span></a>
    <a href="${series}/1">العودة إلى الفصل الأول</a>
    <a href="https://evil.example/series/god-of-martial-arts/116.1">التالي</a>
    <a href="${series}/other/path">التالي</a>
  `;
  const info = __test.teamXChapterLinksFromReader(html, series, 114.3);
  assert.equal(info.hasNavigation, true);
  assert.equal(info.previous, 114.2);
  assert.equal(info.next, 115.1);
  assert.deepEqual(info.chapters.map(c => c.number), [114.2, 114.3, 115.1]);
  const window = readerChapterWindow(info.chapters, 114.3);
  assert.equal(window.previous.number, 114.2);
  assert.equal(window.next.number, 115.1);
  assert.deepEqual(__test.parseTeamXPages(html).length, 2);
});

test("Team-X reuses actual source chapter selector entries without fabricating decimals", () => {
  const rows = Array.from({ length: 80 }, (_, index) => 110 + index / 10);
  const options = rows.map(n => `<option value="${series}/${n}">الفصل ${n}</option>`).join("");
  const html = `<select>${options}</select><a href="${series}/113.9">الفصل السابق</a>`;
  const result = __test.teamXChapterLinksFromReader(html, series, 114);
  assert.equal(result.hasNavigation, true);
  assert.ok(result.chapters.length <= 36);
  assert.ok(result.chapters.some(ch => ch.number === 114));
  assert.ok(result.chapters.some(ch => ch.number === 114.1));
  assert.ok(!result.chapters.some(ch => ch.number === 999));
});

test("Team-X reader fast path checks chapter page before any paginated archive lookup", async () => {
  const code = await readFile(new URL("../functions/api/source/[[path]].js", import.meta.url), "utf8");
  const start = code.indexOf("async function teamXChapter(db, item, number)");
  const end = code.indexOf("function parseTeamXPages(html)", start);
  const chapter = code.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.ok(chapter.indexOf("teamXFetchText(directChapterUrl)") < chapter.indexOf("teamXSeries(db, item)"));
  assert.ok(chapter.indexOf("if (links.hasNavigation)") < chapter.indexOf("teamXReaderChapters(series, number)"));
  assert.match(chapter, /chapterListComplete: false/);
  assert.match(chapter, /CHAPTER_LOCKED/);
  assert.match(chapter, /NO_PAGES/);
});

test("series results are memoized with short lifetime and bounded memory", async () => {
  const code = await readFile(new URL("../src/services/sources.ts", import.meta.url), "utf8");
  assert.match(code, /SERIES_CACHE_TTL_MS = 90_000/);
  assert.match(code, /SERIES_CACHE_LIMIT = 24/);
  assert.match(code, /seriesRequests\.get\(key\)/);
  assert.match(code, /seriesCache\.get\(key\)/);
  assert.match(code, /seriesRequests\.delete\(key\)/);
});

test("opening God Of Martial Arts 114.3 returns chapter pages with one upstream request", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(String(url));
    assert.equal(options.redirect, "manual");
    return new Response(`
      <div class="image_list"><img src="https://cdn-stellarsaber.com/chapter/page1.webp"></div>
      <a href="${series}/114.2">الفصل السابق</a>
      <a href="${series}/115.1">الفصل التالي</a>
    `, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  const item = {
    key: "tx:god-of-martial-arts",
    source: "teamx",
    sourceId: "god-of-martial-arts",
    slug: "god-of-martial-arts",
    title: "God Of Martial Arts",
    url: series,
  };
  const db = { prepare() { assert.fail("fast path must not query the archive database"); } };
  const payload = await __test.teamXChapter(db, item, 114.3);
  assert.equal(seen.length, 1, "chapter HTML loads before any series or pagination fetch");
  assert.equal(seen[0], series + "/114.3");
  assert.equal(payload.number, 114.3);
  assert.equal(payload.pages.length, 1);
  assert.equal(payload.previous, 114.2);
  assert.equal(payload.next, 115.1);
  assert.equal(payload.item.chapterListComplete, false);
  assert.deepEqual(payload.item.chapters.map(c => c.number), [114.2, 114.3, 115.1]);
});
