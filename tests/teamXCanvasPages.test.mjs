import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTeamXCanvasPageMeta,
  parseTeamXCanvasPages,
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
