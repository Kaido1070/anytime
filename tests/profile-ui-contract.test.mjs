import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 5 keeps the existing friend profile route and adds no duplicate profile route", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /path="friends\/:id" element={<FriendProfile \/>}/);
  assert.doesNotMatch(app, /path="(?:profile|users|member)\/:id"/);
});

test("Phase 5 private profile UI renders favorites without hidden social sections", async () => {
  const source = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");
  assert.match(source, /isPrivate \? \(\s*<FavoritesSection/);
  assert.match(source, /profile\.access === "private"/);
  assert.match(source, /highestReachedChapter/);
  assert.doesNotMatch(source, /lastReadChapter/);
  assert.doesNotMatch(source, /Reading History|readingHistory/);
});

test("Phase 5 public list view hides every management action behind canManage", async () => {
  const source = await readFile(new URL("../src/pages/UserList.tsx", import.meta.url), "utf8");
  assert.match(source, /canManage && \(\s*<div className="list-detail-actions">/);
  assert.match(source, /\{canManage && \(\s*<button\s+className="list-drag-handle"/);
  assert.match(source, /\{canManage && \(\s*<button className="list-remove"/);
  assert.match(source, /if \(!canManage \|\| savingOrder\) return/);
});

test("Phase 5 styles remain mobile-first and remove readonly list control columns", async () => {
  const css = await readFile(new URL("../src/phase5.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 759px\)/);
  assert.match(css, /\.list-sortable-row\.read-only/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
});
