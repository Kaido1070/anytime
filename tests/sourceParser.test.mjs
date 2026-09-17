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


test("3asq parser reads Madara chapter numbers and URLs", () => {
  const html = `
    <ul>
      <li class="wp-manga-chapter"><a href="https://3asq.online/manga/one-piece/chapter-1193/">الفصل 1193</a></li>
      <li class="wp-manga-chapter"><a href="/manga/one-piece/1037_1/">الفصل 1037.1</a></li>
    </ul>
  `;
  const chapters = __test.parseAsqChapters(html, "https://3asq.online/manga/one-piece/");
  assert.deepEqual(chapters.map((chapter) => chapter.number), [1193, 1037.1]);
  assert.ok(chapters[0].url.includes("/manga/one-piece/chapter-1193/"));
});

test("3asq page parser prefers lazy Madara page images", () => {
  const html = `
    <div class="reading-content">
      <div class="page-break"><img src="data:image/gif;base64,placeholder" data-src="https://cdn.example.com/001.webp"></div>
      <div class="page-break"><img data-lazy-src="https://cdn.example.com/002.webp"></div>
    </div>
    <footer><img src="/logo.png"></footer>
  `;
  assert.deepEqual(__test.parseAsqPages(html), [
    "https://cdn.example.com/001.webp",
    "https://cdn.example.com/002.webp",
  ]);
});

test("3asq chapter number parser handles Madara slugs", () => {
  assert.equal(__test.asqChapterNumber("الفصل 12.5", "chapter-12-5"), 12.5);
  assert.equal(__test.asqChapterNumber("", "1037_1"), 1037.1);
});


test("3asq type classifier distinguishes novels and web novels", () => {
  assert.equal(__test.normalizeAsqType("رواية"), "novel");
  assert.equal(__test.normalizeAsqType("رواية ويب"), "web-novel");
  assert.equal(__test.normalizeAsqType("Web Novel"), "web-novel");
  assert.equal(__test.normalizeAsqType("مانجا"), "manga");
});
