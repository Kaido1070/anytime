import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../functions/api/source/[[path]].js";

test("Team-X parser finds real chapter links and synthesizes gaps", () => {
  const html = `
    <a href="/series/villain-is-here/357"><div>الفصل 357 معركة</div></a>
    <a href="/series/villain-is-here/355"><div>الفصل 355</div></a>
    <a href="/series/villain-is-here/1"><div>الفصل 1</div></a>
  `;
  const chapters = __test.parseTeamXChapters(
    html,
    "https://olympustaff.com/series/villain-is-here",
  );
  assert.equal(chapters[0].number, 357);
  assert.equal(chapters.at(-1).number, 1);
  assert.ok(chapters.some((chapter) => chapter.number === 356));
});

test("Team-X page parser prefers the image_list area", () => {
  const html = `
    <img src="/logo.png">
    <div class="image_list">
      <img src="https://cdn.example.com/chapter/1.webp">
      <img data-src="https://cdn.example.com/chapter/2.webp">
    </div>
    <div id="comments"><img src="/avatar.png"></div>
  `;
  const pages = __test.parseTeamXPages(html);
  assert.deepEqual(pages.slice(0, 2), [
    "https://cdn.example.com/chapter/1.webp",
    "https://cdn.example.com/chapter/2.webp",
  ]);
});

test("source status normalization supports Arabic and English", () => {
  assert.equal(__test.normalizeStatus("مستمرة"), "ongoing");
  assert.equal(__test.normalizeStatus("Completed"), "completed");
  assert.equal(__test.normalizeStatus("متوقف"), "hiatus");
});
