import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../functions/api/source/[[path]].js";

test("only trusted God Of Martial Arts source keys can recover a missing D1 catalog entry", () => {
  const expected = [
    ["tx:god-of-martial-arts", "teamx", "https://olympustaff.com/series/god-of-martial-arts"],
    ["sz:god-of-martial-arts", "starzmanga", "https://starzmanga.com/manga/god-of-martial-arts/"],
    ["ml:god-of-martial-arts", "mangalik", "https://mangalik.net/manga/god-of-martial-arts/"],
  ];
  for (const [key, source, url] of expected) {
    const item = __test.recoverGodOfMartialArts(key);
    assert.equal(item.key, key);
    assert.equal(item.source, source);
    assert.equal(item.url, url);
    assert.equal(item.slug, "god-of-martial-arts");
    assert.equal(item.title, "God Of Martial Arts");
    assert.deepEqual(item.chapters, undefined, "recovery never invents chapter rows");
  }
  for (const key of [
    "tx:another-story",
    "tx:god-of-martial-arts-attacker",
    "aq:god-of-martial-arts",
    "mt:god-of-martial-arts",
    "tx:god-of-martial-arts/../../evil",
  ]) {
    assert.equal(__test.recoverGodOfMartialArts(key), null);
  }
});

test("existing catalog entries always take precedence over recovery", async () => {
  const original = {
    source_key: "tx:god-of-martial-arts",
    source: "teamx",
    source_id: "god-of-martial-arts",
    slug: "god-of-martial-arts",
    type: "series",
    url: "https://olympustaff.com/series/god-of-martial-arts",
    title: "Existing Saved Title",
    cover_url: "https://olympustaff.com/static/cover.webp",
    genres_json: "[]",
  };
  let calls = 0;
  const db = { prepare() { return { bind(key) {
    assert.equal(key, original.source_key);
    return { async first() { calls++; return original; } };
  }}; }};
  const item = await __test.loadItem(db, original.source_key);
  assert.equal(item.title, "Existing Saved Title");
  assert.equal(item.cover, original.cover_url);
  assert.equal(calls, 1);
  assert.equal(item.url, original.url, "a correct existing permalink stays intact");
});

test("stale saved permalink for the same series is normalized without losing catalog metadata", async () => {
  const key = "tx:god-of-martial-arts";
  const db = { prepare() { return { bind() { return { async first() {
    return {
      source_key: key,
      source: "teamx",
      source_id: "god-of-martial-arts",
      slug: "old-or-broken-slug",
      type: "series",
      url: "https://olympustaff.com/series/old-or-broken-slug",
      title: "User's existing catalog title",
      cover_url: "https://olympustaff.com/images/real-cover.webp",
      genres_json: "[]",
    };
  } }; } }; } };
  const result = await __test.loadItem(db, key);
  assert.equal(result.slug, "god-of-martial-arts");
  assert.equal(result.url, "https://olympustaff.com/series/god-of-martial-arts");
  assert.equal(result.title, "User's existing catalog title");
  assert.equal(result.cover, "https://olympustaff.com/images/real-cover.webp");
});

test("missing Team-X catalog entry falls back to an upstream-verifiable permalink", async () => {
  const db = {
    prepare() { return { bind() { return { async first() { return null; } }; } }; },
  };
  const item = await __test.loadItem(db, "tx:god-of-martial-arts");
  assert.equal(item.url, "https://olympustaff.com/series/god-of-martial-arts");
  assert.equal(item.source, "teamx");
  assert.equal(await __test.loadItem(db, "tx:unrelated-series"), null);
});
