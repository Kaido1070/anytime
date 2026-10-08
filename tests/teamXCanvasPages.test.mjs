import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTeamXCanvasPageMeta,
  parseTeamXCanvasPages,
  __test,
} from "../functions/api/source/chapter.js";

test("Team-X reader prefers lazy canvas pages over a promo image", () => {
  const html = `
    <div class="image_list reader-images">
      <img src="/uploads/banner-lord-of-truth.jpg">
      <canvas data-src="/uploads/chapter-1/001.webp"></canvas>
      <canvas data-src="https://cdn.example.com/chapter-1/002.webp"></canvas>
      <canvas data-src="/uploads/chapter-1/003.webp"></canvas>
    </div>
    <footer><img src="/logo.png"></footer>
  `;

  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/uploads/chapter-1/001.webp",
    "https://cdn.example.com/chapter-1/002.webp",
    "https://olympustaff.com/uploads/chapter-1/003.webp",
  ]);
});

test("Team-X reader preserves canvas display dimensions", () => {
  const html = `
    <div class="image_list reader-images">
      <canvas width="900" height="1350" data-src="/uploads/chapter-1/001.webp"></canvas>
      <canvas data-width="800" data-height="1200" data-src="/uploads/chapter-1/002.webp"></canvas>
      <canvas style="width: 700px; height: 1050px" data-src="/uploads/chapter-1/003.webp"></canvas>
    </div>
    <footer></footer>
  `;

  assert.deepEqual(parseTeamXCanvasPageMeta(html), [
    {
      url: "https://olympustaff.com/uploads/chapter-1/001.webp",
      width: 900,
      height: 1350,
    },
    {
      url: "https://olympustaff.com/uploads/chapter-1/002.webp",
      width: 800,
      height: 1200,
    },
    {
      url: "https://olympustaff.com/uploads/chapter-1/003.webp",
      width: 700,
      height: 1050,
    },
  ]);
});

test("Team-X reader still supports chapters that use normal img tags", () => {
  const html = `
    <div class="image_list">
      <img data-src="/storage/chapter/01.jpg">
      <img src="/storage/chapter/02.jpg">
    </div>
    <footer></footer>
  `;

  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/storage/chapter/01.jpg",
    "https://olympustaff.com/storage/chapter/02.jpg",
  ]);
});


test("Team-X excludes a confirmed missing trailing canvas before returning chapter pages", async () => {
  const pages = [
    { url: "https://olympustaff.com/uploads/chapter/001.webp" },
    { url: "https://olympustaff.com/uploads/chapter/002.webp" },
    { url: "https://olympustaff.com/uploads/chapter/dead.webp" },
  ];
  const checked = [];
  const fetchSource = async (url) => {
    checked.push(url);
    return new Response(null, { status: url.endsWith("dead.webp") ? 404 : 403 });
  };
  const filtered = await __test.filterKnownTeamXBanners(
    pages, "https://olympustaff.com/series/example/4", fetchSource,
  );
  assert.deepEqual(filtered, pages.slice(0, 2));
  assert.equal(checked[0], pages[2].url, "trailing canvas must be checked first");
});

test("Team-X excludes HTML masquerading as the final chapter image", async () => {
  const pages = [
    { url: "https://olympustaff.com/uploads/chapter/003.webp" },
    { url: "https://olympustaff.com/uploads/chapter/missing.webp" },
  ];
  const filtered = await __test.filterKnownTeamXBanners(
    pages, "https://olympustaff.com/series/example/4",
    async (url) => url.endsWith("missing.webp")
      ? new Response("<html>not an image</html>", { headers: { "Content-Type": "text/html" } })
      : new Response(null, { status: 403 }),
  );
  assert.deepEqual(filtered, pages.slice(0, 1));
});

test("Team-X retains temporarily blocked pages rather than deleting real chapter content", async () => {
  const pages = [
    { url: "https://olympustaff.com/uploads/chapter/004.webp" },
    { url: "https://olympustaff.com/uploads/chapter/005.webp" },
  ];
  const filtered = await __test.filterKnownTeamXBanners(
    pages, "https://olympustaff.com/series/example/4",
    async () => new Response(null, { status: 503 }),
  );
  assert.deepEqual(filtered, pages);
});

test("Team-X verifies the trailing image even in chapters longer than 64 pages", async () => {
  const pages = Array.from({ length: 75 }, (_, index) => ({
    url: `https://olympustaff.com/uploads/long-chapter/${index}.webp`,
  }));
  const checked = [];
  const filtered = await __test.filterKnownTeamXBanners(
    pages, "https://olympustaff.com/series/example/4",
    async (url) => {
      checked.push(url);
      return new Response(null, { status: url === pages[74].url ? 410 : 403 });
    },
  );
  assert.equal(filtered.length, 74);
  assert.equal(checked[0], pages[74].url);
});


test("Team-X does not collect images outside the reader image_list", () => {
  const html = `
    <div class="image_list">
      <canvas data-src="/chapter/001.webp"></canvas>
      <div class="page"><canvas data-src="/chapter/002.webp"></canvas></div>
    </div>
    <div class="recommended"><canvas data-src="/novel-promo.webp"></canvas></div>
    <footer></footer>
  `;
  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/chapter/001.webp",
    "https://olympustaff.com/chapter/002.webp",
  ]);
});

test("Team-X excludes clickable novel promotions within the reader", () => {
  const html = `
    <div class="image_list">
      <canvas data-src="/chapter/001.webp"></canvas>
      <a href="/series/lord-of-the-truth">
        <canvas data-src="/ads/promo-unique-filename.webp"></canvas>
      </a>
      <canvas data-src="/chapter/002.webp"></canvas>
    </div>
  `;
  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/chapter/001.webp",
    "https://olympustaff.com/chapter/002.webp",
  ]);
});

test("Team-X removes the recurring Lord of Truth image even without a wrapping link", () => {
  const html = `
    <div class="image_list">
      <canvas data-src="/chapter/001.webp"></canvas>
      <canvas data-src="/uploads/Lord-of-Truth-banner.webp"></canvas>
    </div>
  `;
  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/chapter/001.webp",
  ]);
});

test("Team-X excludes linked promos in img-based chapters without losing real images", () => {
  const html = `
    <div class="image_list">
      <img src="/chapter/001.jpg">
      <a href="/series/lord-of-the-truth"><img src="/promo/teaser.jpg"></a>
      <img data-src="/chapter/002.jpg">
    </div>
  `;
  assert.deepEqual(parseTeamXCanvasPages(html), [
    "https://olympustaff.com/chapter/001.jpg",
    "https://olympustaff.com/chapter/002.jpg",
  ]);
});
