import test from "node:test";
import assert from "node:assert/strict";
import { readerChapterWindow } from "../src/services/readerNavigation.ts";

const chapters = Array.from({ length: 1500 }, (_, i) => ({ number: i + 1, title: `الفصل ${i + 1}`, url: `https://example.com/story/${i + 1}` })).reverse();
test("long archive shows five before and thirty after the current chapter", () => {
  const result = readerChapterWindow(chapters, 600);
  assert.deepEqual(result.options.map(c => c.number), Array.from({length: 36}, (_, i) => 595 + i));
  assert.equal(result.selectedIndex, 5);
  assert.equal(result.previous.number, 599);
  assert.equal(result.next.number, 601);
});
test("first and last chapters only disable the actual archive boundary", () => {
  const first = readerChapterWindow(chapters, 1);
  assert.equal(first.previous, undefined);
  assert.equal(first.next.number, 2);
  assert.equal(first.options.length, 31);
  const last = readerChapterWindow(chapters, 1500);
  assert.equal(last.previous.number, 1499);
  assert.equal(last.next, undefined);
  assert.equal(last.options.length, 6);
});
test("fractional and duplicate chapters preserve source URL identity", () => {
  const rows = [{number: 407.1, url: "https://example.com/a"}, {number: 407.2, url: "https://example.com/b"}, {number: 407.2, url: "https://example.com/c"}, {number: 407.3, url: "https://example.com/d"}];
  const result = readerChapterWindow(rows, 407.2, "https://example.com/c/");
  assert.equal(result.selectedIndex, 2);
  assert.equal(result.previous.url, "https://example.com/b");
  assert.equal(result.next.number, 407.3);
});
test("missing current chapter never silently selects the latest preview", () => {
  const result = readerChapterWindow(chapters.slice(0, 20), 1);
  assert.equal(result.options[result.selectedIndex].number, 1);
  assert.equal(result.next, undefined);
});

import { __test } from "../functions/api/source/[[path]].js";
test("Team-X locates an early fractional chapter across paginated 1500-row archives", async () => {
  const url = "https://olympustaff.com/series/long-story";
  const archive = Array.from({length: 1500}, (_, i) => ({number: (i + 1) / 10})).reverse();
  const html = (rows) => rows.map(row => `<a href="${url}/${row.number}">الفصل ${row.number}</a>`).join("");
  const calls = [];
  const result = await __test.teamXReaderChapters({url, chapterPageCount: 15, chapters: __test.parseTeamXChapters(html(archive.slice(0, 100)), url)}, 9.8, async target => {
    const page = Number(new URL(target).searchParams.get("page"));
    calls.push(page);
    return html(archive.slice((page - 1) * 100, page * 100));
  });
  const window = readerChapterWindow(result, 9.8);
  assert.equal(window.previous.number, 9.7);
  assert.equal(window.next.number, 9.9);
  assert.equal(window.options.length, 36);
  assert.equal(window.options[0].number, 9.3);
  assert.equal(window.options.at(-1).number, 12.8);
  assert.ok(calls.length <= 6, `upstream requests: ${calls.length}`);
});

 test("Team-X archive search tolerates a pinned first chapter on every page", async () => {
  const url = "https://olympustaff.com/series/pinned";
  const archive = Array.from({length: 1500}, (_, i) => i + 1).reverse();
  const html = page => [...archive.slice((page - 1) * 100, page * 100), 1].map(number => `<a href="${url}/${number}">الفصل ${number}</a>`).join("");
  for (const number of [1, 105, 225]) {
    const result = await __test.teamXReaderChapters({url, chapterPageCount: 15, chapters: __test.parseTeamXChapters(html(1), url)}, number, async target => html(Number(new URL(target).searchParams.get("page"))));
    const window = readerChapterWindow(result, number);
    assert.equal(window.previous?.number, number > 1 ? number - 1 : undefined);
    assert.equal(window.next.number, number + 1);
    assert.equal(window.options.length, number > 5 ? 36 : 31);
  }
});
