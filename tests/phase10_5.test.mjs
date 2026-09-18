import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatArabicRelativeTime } from "../src/services/dateFormat.ts";
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
  assert.equal(formatArabicRelativeTime(now - 14 * 24 * 60 * 60_000, now), "04/09/2026");
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

test("chapter availability uses published time first and stable first_seen fallback, never update time", async () => {
  const [sourceApi, feed] = await Promise.all([
    readFile(new URL("../functions/api/source/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/newChapters.ts", import.meta.url), "utf8"),
  ]);

  assert.match(sourceApi, /source_chapter_seen/);
  assert.match(sourceApi, /first_seen_at/);
  assert.match(sourceApi, /synthetic: true/);
  assert.match(sourceApi, /filter\(\(chapter\) => !chapter\.synthetic\)/);
  assert.match(sourceApi, /published_at = COALESCE\(excluded\.published_at, source_chapter_seen\.published_at\)/);
  assert.match(feed, /parsePublished\(chapter\.publishedAt\)/);
  assert.match(feed, /chapter\.baselineObserved/);
  assert.match(feed, /chapter\.firstSeenAt/);
  const releaseFunction = feed.slice(feed.indexOf("function releaseFor"), feed.indexOf("function readKey"));
  assert.doesNotMatch(releaseFunction, /updated/i);
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
