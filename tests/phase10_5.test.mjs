import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatArabicRelativeTime } from "../src/services/dateFormat.ts";
import ts from "typescript";
import {
  rankRecommendations,
  recommendationFeatureSignature,
} from "../src/services/recommendations.ts";

function work(key, genres, type = "manhwa") {
  return {
    key,
    source: "mangatime",
    sourceId: key,
    slug: key,
    type,
    url: "https://example.test/" + key,
    title: key,
    cover: "https://example.test/" + key + ".jpg",
    genres,
  };
}

function candidate(key, genres, popularity = 0.5, freshness = 0.5) {
  return {
    item: work(key, genres),
    sourceKeys: [key],
    popularity,
    freshness,
  };
}

test("FYP gives matching content a materially stronger result than unrelated content", () => {
  const favorite = work("mt:favorite", ["Murim", "Martial Arts", "Fantasy"]);
  const results = rankRecommendations(
    [
      candidate("mt:match", ["Murim", "Martial Arts", "Regression"]),
      candidate("mt:unrelated", ["Romance", "School", "Comedy"], 1, 1),
    ],
    [{ item: favorite, weight: 6, kind: "favorite" }],
  );

  assert.equal(results[0].item.key, "mt:match");
  assert.ok(results[0].reason.includes("مفضلتك"));
  assert.ok(results.every((result) => result.item.key !== "mt:favorite"));
});

test("feature normalization does not reward a work merely for having more metadata", () => {
  const favorite = work("mt:seed", ["Murim"]);
  const results = rankRecommendations(
    [
      candidate("mt:focused", ["Murim"]),
      candidate("mt:noisy", ["Murim", "Action", "Fantasy", "Comedy", "School"]),
    ],
    [{ item: favorite, weight: 6, kind: "favorite" }],
  );

  assert.equal(results[0].item.key, "mt:focused");
});

test("FYP ranking is deterministic and diversity reranking reduces adjacent clones", () => {
  const seed = work("mt:seed", ["Murim", "Action"]);
  const candidates = [
    candidate("mt:a", ["Murim", "Action"]),
    candidate("mt:b", ["Murim", "Action"]),
    candidate("mt:c", ["Murim", "Action"]),
    candidate("mt:adjacent", ["Murim", "Fantasy"]),
  ];
  const signals = [{ item: seed, weight: 6, kind: "favorite" }];

  const first = rankRecommendations(candidates, signals);
  const second = rankRecommendations(candidates, signals);
  assert.deepEqual(first.map((entry) => entry.item.key), second.map((entry) => entry.item.key));

  const firstThreeSignatures = new Set(
    first.slice(0, 3).map((entry) => recommendationFeatureSignature(entry.item)),
  );
  assert.ok(firstThreeSignatures.size >= 2);
});

test("cold start uses a factual fallback and never invents personal taste", () => {
  const results = rankRecommendations(
    [
      candidate("mt:a", ["Action"], 0.9, 0.5),
      candidate("mt:b", ["Romance"], 0.4, 1),
    ],
    [],
  );
  assert.equal(results[0].item.key, "mt:a");
  assert.ok(results.every((entry) => !/لأنك|تحب|مفضلتك/.test(entry.reason)));
});

test("relative release time stays Arabic while long dates stay Gregorian", () => {
  const now = Date.UTC(2026, 8, 18, 12, 0, 0);
  assert.equal(formatArabicRelativeTime(now - 12 * 60_000, now), "منذ 12 دقيقة");
  assert.equal(formatArabicRelativeTime(now - 60 * 60_000, now), "منذ ساعة");
  assert.equal(formatArabicRelativeTime(now - 2 * 60 * 60_000, now), "منذ ساعتين");
  assert.equal(formatArabicRelativeTime(now - 24 * 60 * 60_000, now), "أمس");
  assert.match(formatArabicRelativeTime(now - 20 * 24 * 60 * 60_000, now), /\d{2}\/\d{2}\/\d{4}/);
});

test("Phase 10.5 navigation exposes exactly the four social destinations and keeps admin isolated", async () => {
  const [layout, app, adminLayout] = await Promise.all([
    readFile(new URL("../src/layouts/AppLayout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/layouts/AdminLayout.tsx", import.meta.url), "utf8"),
  ]);

  for (const label of ["استكشف", "FYP", "جديد", "حسابي"]) {
    assert.match(layout, new RegExp('label: "' + label + '"'));
  }
  assert.match(app, /path="fyp" element={<Fyp \/>}/);
  assert.match(app, /path="new" element={<NewChapters \/>}/);
  assert.match(layout, /loadUnreadFollowedCount/);
  assert.doesNotMatch(adminLayout, /FYP|جديد|استكشف|حسابي/);
});

test("New tracking is an active union and exact read state reuses reading_history", async () => {
  const [api, feed, migration] = await Promise.all([
    readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/newChapters.ts", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0010_phase10_5.sql", import.meta.url), "utf8"),
  ]);

  assert.match(api, /FROM user_library/);
  assert.match(api, /FROM favorites/);
  assert.match(api, /FROM user_list_items i/);
  assert.match(api, /MIN\(start.*\) AS tracking_started_at/i);
  assert.match(api, /FROM reading_history/);
  assert.match(api, /ABS\(chapter - \?\) < 0\.000001/);
  assert.match(api, /path === "personalization-state"/);
  assert.match(api, /ADMIN_NOT_SOCIAL/);
  assert.match(api, /\.slice\(0, 40\)/);
  assert.match(feed, /chapter\.releaseAt > Number\(group\.trackingStartedAt\)/);
  assert.match(migration, /idx_reading_history_user_chapter/);
});

test("chapter availability retains observation metadata but the New feed requires publication time", async () => {
  const [sourceApi, feed] = await Promise.all([
    readFile(new URL("../functions/api/source/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/newChapters.ts", import.meta.url), "utf8"),
  ]);

  assert.match(sourceApi, /source_chapter_seen/);
  assert.match(sourceApi, /first_seen_at/);
  assert.match(sourceApi, /synthetic: true/);
  assert.match(sourceApi, /filter\(\(chapter\) => !chapter\.synthetic\)/);
  assert.match(sourceApi, /published_at = COALESCE\(\?, published_at\)/);
  assert.match(sourceApi, /if \(!numberChanged && !publicationChanged\) continue/);
  assert.match(feed, /parsePublished\(chapter\.publishedAt\)/);
  const releaseFunction = feed.slice(feed.indexOf("function releaseFor"), feed.indexOf("function readKey"));
  assert.match(releaseFunction, /published == null \? null/);
  assert.doesNotMatch(releaseFunction, /chapter\.(?:updatedAt|firstSeenAt|baselineObserved)/);
});

test("FYP implementation centralizes weights, excludes known works, caches by algorithm and taste version", async () => {
  const [page, config] = await Promise.all([
    readFile(new URL("../src/pages/Fyp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/recommendationConfig.ts", import.meta.url), "utf8"),
  ]);
  assert.match(config, /favorite: 6/);
  assert.match(config, /completed: 5/);
  assert.match(config, /reading: 3/);
  assert.match(config, /list: 2\.5/);
  assert.match(config, /planned: 1/);
  assert.match(config, /paused: -1/);
  assert.match(config, /perWorkCap/);
  assert.match(page, /knownKeys/);
  assert.match(page, /!group\.items\.some\(\(item\) => knownKeys\.has\(item\.key\)\)/);
  assert.match(page, /RECOMMENDATION_CACHE_TTL_MS/);
  assert.match(page, /tasteSignature/);
  assert.match(page, /algorithmVersion/);
});


test("New page is a flat 24-hour chapter timeline", async () => {
  const [page, feed] = await Promise.all([
    readFile(new URL("../src/pages/NewChapters.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/newChapters.ts", import.meta.url), "utf8"),
  ]);

  assert.match(feed, /NEW_CHAPTER_WINDOW_MS = 24 \* 60 \* 60_000/);
  assert.match(feed, /chapter\.releaseAt > cutoff/);
  assert.match(page, /page\.all/);
  assert.match(page, /b\.chapter\.releaseAt - a\.chapter\.releaseAt/);
  assert.match(page, /آخر 24 ساعة/);
  assert.doesNotMatch(page, /متابعتي/);
  assert.doesNotMatch(page, /new-work-group/);
});

test("New feed excludes observation-only, invalid, future, synthetic and 24-hour boundary chapters", async (t) => {
  const now = Date.UTC(2026, 9, 6, 17);
  const originalNow = Date.now;
  t.after(() => {
    Date.now = originalNow;
  });
  Date.now = () => now;
  const fixtures = [
    ["fresh", { publishedAt: new Date(now - 60_000).toISOString() }],
    ["current", { publishedAt: new Date(now).toISOString() }],
    ["boundary", { publishedAt: new Date(now - 24 * 60 * 60_000).toISOString() }],
    ["old", { publishedAt: new Date(now - 25 * 60 * 60_000).toISOString(), updatedAt: now }],
    ["observed", { publishedAt: null, firstSeenAt: now, baselineObserved: false }],
    ["invalid", { publishedAt: "not-a-date", firstSeenAt: now }],
    ["future", { publishedAt: new Date(now + 60_000).toISOString() }],
    ["synthetic", { publishedAt: new Date(now).toISOString(), synthetic: true }],
  ];
  const items = fixtures.map(([id, chapter]) => ({
    ...work(`mt:${id}`, []),
    chapters: [{ number: 1, title: "الفصل 1", ...chapter }],
  }));
  const sourceService = {
    recent: async (source, page) => ({
      items: source === "mangatime" ? items : [], hasMore: false, page,
    }),
  };
  const userDataService = {
    getPersonalizationState: async () => ({
      followed: [{ mangaId: "mt:fresh", trackingStartedAt: now - 120_000 }],
    }),
    getReadChapterPairs: async () => [],
  };
  // Run the actual feed implementation with isolated source/account boundaries;
  // source merging has its own tests and no network/storage is touched here.
  const source = await readFile(new URL("../src/services/newChapters.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source.replace(/^import[\s\S]*?;\n/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace(/^export /gm, "");
  const { loadNewChapterFeed } = new Function(
    "mergeSourceItems", "preferredSourceCover", "sourceService", "userDataService",
    code + "\nreturn { loadNewChapterFeed };",
  )(
    (rows) => rows.map((item) => ({ id: item.key, primary: item, items: [item] })),
    (rows) => rows[0], sourceService, userDataService,
  );
  const feed = await loadNewChapterFeed();
  assert.deepEqual(feed.all.map((group) => group.item.key), ["mt:current", "mt:fresh"]);
  assert.equal(feed.unreadFollowedCount, 1);
  assert.equal(feed.followed[0].item.key, "mt:fresh");
});
