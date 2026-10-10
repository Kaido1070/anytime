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

test("God Of Martial Arts saved-details recovery reads genuine D1 chapter observations only", async () => {
  let requested;
  const db = {
    prepare(sql) {
      requested = sql;
      return {
        bind(key) {
          assert.equal(key, "tx:god-of-martial-arts");
          return {
            async all() {
              return { results: [
                { chapter_number: 114.3, published_at: null },
                { chapter_number: 114.2, published_at: "2026-01-01T00:00:00.000Z" },
                { chapter_number: "invalid", published_at: null },
              ] };
            },
          };
        },
      };
    },
  };
  const item = __test.recoverGodOfMartialArts("tx:god-of-martial-arts");
  const result = await __test.recoverRecordedGodOfMartialArts(db, item);
  assert.match(requested, /FROM source_chapter_seen/);
  assert.match(requested, /LIMIT 1200/);
  assert.equal(result.sourceTemporarilyUnavailable, true);
  assert.equal(result.chapterListComplete, false);
  assert.equal(result.title, "God Of Martial Arts");
  assert.deepEqual(result.chapters.map(c => c.number), [114.3, 114.2]);
  assert.ok(result.chapters.every(c => !("url" in c)), "never fabricate links");
  assert.equal(result.latest, 114.3);
});

test("only exact canonical God Of Martial Arts URLs may retry the verified alternate host", () => {
  for (const url of [
    "https://olympustaff.com/series/god-of-martial-arts",
    "https://www.olympustaff.com/series/god-of-martial-arts/",
    "https://olympustaff.com/series/god-of-martial-arts/114.3",
  ]) assert.equal(__test.isGodOfMartialArtsTeamXUrl(url), true, url);
  for (const url of [
    "https://olympustaff.com/series/god-of-martial-arts-evil",
    "https://olympustaff.com/series/other-manga",
    "https://evil.example/series/god-of-martial-arts",
    "https://olympustaff.com/series/god-of-martial-arts/114.3/extra",
  ]) assert.equal(__test.isGodOfMartialArtsTeamXUrl(url), false, url);
});

test("failed God Of Martial Arts request retries only the exact allowlisted WWW mirror", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const visited = [];
  globalThis.fetch = async (url, options) => {
    visited.push({ url: String(url), referer: options?.headers?.Referer });
    if (visited.length === 1) throw new Error("Temporary origin timeout");
    return new Response("<html>chapter</html>", { headers: { "Content-Type": "text/html" } });
  };
  const html = await __test.teamXFetchText("https://olympustaff.com/series/god-of-martial-arts/114.3");
  assert.match(html, /chapter/);
  assert.deepEqual(visited.map(v => v.url), [
    "https://olympustaff.com/series/god-of-martial-arts/114.3",
    "https://www.olympustaff.com/series/god-of-martial-arts/114.3",
  ]);
  assert.equal(visited[1].referer, "https://www.olympustaff.com/");
});

test("unrelated Team-X stories never receive extra mirror requests", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Origin unavailable"); };
  await assert.rejects(__test.teamXFetchText("https://olympustaff.com/series/another-story"), /Origin unavailable/);
  assert.equal(calls, 1);
});

test("God Of Martial Arts details may open from previously saved metadata while source is down", async () => {
  const { readFile } = await import("node:fs/promises");
  const details = await readFile(new URL("../src/pages/SourceMangaDetails.tsx", import.meta.url), "utf8");
  assert.match(details, /VERIFIED_MARTIAL_KEYS/);
  assert.match(details, /cachedSnapshotSeries\(\[sourceKey\]\)/);
  assert.match(details, /setLoading\(!saved\)/);
  assert.match(details, /setShowSavedSeries\(true\)/);
  assert.match(details, /setSeriesRetry\(\(value\) => value \+ 1\)/);
  assert.match(details, /آخر البيانات المحفوظة/);
});
