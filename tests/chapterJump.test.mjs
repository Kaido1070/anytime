import test from "node:test";
import assert from "node:assert/strict";
import { parseChapterInput, resolveChapterJump } from "../src/services/chapterJump.ts";

test("chapter numbers accept English, Arabic, Persian and fractional input", () => {
  for (const input of ["58", "٥٨", "۵۸", " 58 "]) assert.equal(parseChapterInput(input), 58);
  for (const input of ["407.3", "٤٠٧٫٣", "407,3", "٤٠٧،٣"]) assert.equal(parseChapterInput(input), 407.3);
  for (const input of ["", "-1", "58x", "1e3", "Infinity", "1.2.3"]) assert.equal(parseChapterInput(input), null);
  assert.equal(parseChapterInput("0"), 0);
});
for (const source of ["teamx", "mangatime", "3asq", "starzmanga", "xsano", "mangalik", "azora"]) {
  test(`${source}: a chapter outside the displayed preview resolves through the source`, async () => {
    const calls = [];
    const item = {key: `${source}:story`, source, chapters: [{number: 407.3, title: "latest"}]};
    const row = await resolveChapterJump(item, "٥٨", async (key, number) => {
      calls.push([key, number]);
      return {number, title: "الفصل 58", url: "https://example.com/story/58"};
    });
    assert.equal(row.number, 58);
    assert.equal(row.url, "https://example.com/story/58");
    assert.deepEqual(calls, [[item.key, 58]]);
  });
}
test("local archive hit preserves exact URL and needs no source request", async () => {
  const chapter = {number: 58.1, title: "chapter", url: "https://example.com/exact"};
  assert.equal(await resolveChapterJump({key: "story", chapters: [chapter]}, "٥٨٫١", async () => {throw new Error("unexpected request");}), chapter);
});
test("upstream errors remain errors rather than a false missing-chapter result", async () => {
  const error = Object.assign(new Error("المصدر متعثر مؤقتًا"), {code: "SOURCE_CIRCUIT_OPEN"});
  await assert.rejects(resolveChapterJump({key: "story", chapters: []}, "58", async () => {throw error;}), cause => cause === error);
});
test("invalid input does not call the source and mismatched responses cannot navigate", async () => {
  await assert.rejects(resolveChapterJump({key: "story"}, "", async () => {assert.fail();}), /رقم فصل صحيح/);
  await assert.rejects(resolveChapterJump({key: "story"}, "58", async () => ({number: 407})), /مختلفًا/);
});

import { __test } from "../functions/api/source/[[path]].js";
test("integer searches prefer exact chapter, otherwise find its first real part", () => {
  const parts = [{number: 58.3}, {number: 58.1}, {number: 58.2}];
  assert.equal(__test.findChapterNumber(parts, 58).number, 58.1);
  assert.equal(__test.findChapterNumber([...parts, {number: 58}], 58).number, 58);
  assert.equal(__test.findChapterNumber(parts, 58.4), undefined);
});
test("Team-X lookup finds split chapter outside latest preview", async () => {
  const url = "https://olympustaff.com/series/split";
  const archive = Array.from({length: 1500}, (_, i) => Math.floor(i / 3) + 1 + ((i % 3) + 1) / 10).reverse();
  const html = page => archive.slice((page - 1) * 100, page * 100).map(number => `<a href="${url}/${number}">الفصل ${number}</a>`).join("");
  const chapters = await __test.teamXReaderChapters({url, chapterPageCount: 15, chapters: __test.parseTeamXChapters(html(1), url)}, 58, async target => html(Number(new URL(target).searchParams.get("page"))));
  assert.equal(__test.findChapterNumber(chapters, 58).number, 58.1);
});
