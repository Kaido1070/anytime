import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { __test, latestLinkedChapter } from "../functions/api/source/[[path]].js";
import { onRequestGet } from "../functions/api/source/latest.js";

// Run the real service graph with Node's TS stripping, matching Vite's local
// extensionless/JSON resolution without replacing the merge implementation.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/src/data/mangatimeEnglishTitles.json")) {
      return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { loadNewChapterFeed, loadUnreadFollowedCount, mergeChapterFeedPages } = await import("../src/services/newChapters.ts");
const { sourceService } = await import("../src/services/sources.ts");
const { userDataService } = await import("../src/services/userData.ts");
hooks.deregister();

const NOW = Date.UTC(2026, 8, 18, 12);
const START = NOW - 100_000;
const OLD = Date.UTC(2025, 1, 1);
function chapter(number, time = NOW - 1000, extra = {}) {
  return { number, title: `Chapter ${number}`, publishedAt: time == null ? null : new Date(time).toISOString(), ...extra };
}
function item(key, chapters = [], latest = null, title = "Ao Ashi") {
  return { key, chapters, latest, title, slug: title.toLowerCase().replaceAll(" ", "-"), source: key.startsWith("aq:") ? "3asq" : "mangatime", sourceId: key, type: "manga", url: "https://example.test/" + key, cover: "", genres: [] };
}
function setup(t, { latest = [], followed = [], details = [], read = [], failed = [] } = {}) {
  t.mock.method(Date, "now", () => NOW);
  t.mock.method(sourceService, "latest", async (source) => ({ items: latest.filter((entry) => entry.source === source), hasMore: false, page: 1 }));
  t.mock.method(sourceService, "resolve", async (keys) => details.filter((entry) => keys.includes(entry.key)).map((entry) => ({ ...entry, chapters: undefined, latest: null })));
  t.mock.method(sourceService, "getSeries", async (key) => {
    if (failed.includes(key)) throw new Error("offline");
    return details.find((entry) => entry.key === key);
  });
  t.mock.method(userDataService, "getPersonalizationState", async () => ({ followed, readingWorks: [] }));
  t.mock.method(userDataService, "getReadChapterPairs", async (pairs) => pairs.filter((pair) => read.some((entry) => entry.mangaId === pair.mangaId && entry.chapter === pair.chapter)));
}
const numbers = (groups) => groups.flatMap((group) => group.chapters.map((entry) => entry.number));

test("all uses list latest=147, not hydrated latest or historical 2025 chapters", async (t) => {
  setup(t, { latest: [item("mt:ao", [], 147)], details: [item("mt:ao", Array.from({ length: 9 }, (_, i) => chapter(148 - i, i > 1 ? OLD : NOW - 1000)), 148)] });
  const feed = await loadNewChapterFeed();
  assert.deepEqual(numbers(feed.all), [147]);
  assert.deepEqual(feed.followed, []);
});

test("all supports different actual latest numbers across canonical variants", async (t) => {
  setup(t, { latest: [item("mt:ao", [], 147), item("aq:ao", [], 146)], details: [item("mt:ao", [chapter(147), chapter(146), chapter(145)]), item("aq:ao", [chapter(146), chapter(145), chapter(144)])] });
  const feed = await loadNewChapterFeed();
  assert.equal(feed.all.length, 1);
  assert.deepEqual(numbers(feed.all), [147, 146]);
});

test("followed-only work includes every release after tracking and excludes before/equal/baseline", async (t) => {
  setup(t, { followed: [{ mangaId: "mt:ao", trackingStartedAt: START }], details: [item("mt:ao", [chapter(1, OLD), chapter(2, START), chapter(3, START + 1), chapter(4, null, { firstSeenAt: START + 2, baselineObserved: true }), chapter(5, null, { firstSeenAt: START + 3, baselineObserved: false }), chapter(6, NOW + 1000), chapter(7, NOW - 1, { synthetic: true })])] });
  const feed = await loadNewChapterFeed(3);
  assert.deepEqual(feed.all, []);
  assert.deepEqual(numbers(feed.followed), [5, 3]);
  assert.equal(feed.followed[0].chapters[0].releaseKind, "first_seen");
  assert.equal(feed.followed[0].newestAt, START + 3);
  assert.equal(await loadUnreadFollowedCount(), 2);
});

test("canonical duplicates merge once, prefer earliest publication and read any variant", async (t) => {
  setup(t, {
    latest: [item("mt:ao", [], 147), item("aq:ao", [], 147)],
    followed: [{ mangaId: "mt:ao", trackingStartedAt: START }],
    details: [item("mt:ao", [chapter(147, NOW - 3000), chapter(146, NOW - 5000)]), item("aq:ao", [chapter(147, NOW - 2000), chapter(146, null, { firstSeenAt: NOW - 1000, baselineObserved: true })])],
    read: [{ mangaId: "aq:ao", chapter: 147 }, { mangaId: "aq:ao", chapter: 146 }],
  });
  const feed = await loadNewChapterFeed();
  assert.deepEqual(numbers(feed.all), [147]);
  assert.equal(feed.all[0].chapters[0].releaseAt, NOW - 3000);
  assert.equal(feed.all[0].chapters[0].sourceKey, "mt:ao");
  assert.ok(feed.followed[0].chapters.every((entry) => entry.read));
  assert.equal(await loadUnreadFollowedCount(), feed.unreadFollowedCount);
  assert.equal(feed.unreadFollowedCount, 0);
});

test("publication beats detection even when the publication predates tracking", async (t) => {
  setup(t, { latest: [item("mt:ao", [], 147), item("aq:ao", [], 147)], followed: [{ mangaId: "mt:ao", trackingStartedAt: START }], details: [item("mt:ao", [chapter(147, null, { firstSeenAt: NOW - 1 })]), item("aq:ao", [chapter(147, OLD)])] });
  const feed = await loadNewChapterFeed();
  assert.equal(feed.all[0].chapters[0].releaseAt, OLD);
  assert.equal(feed.all[0].chapters[0].releaseKind, "published");
  assert.deepEqual(feed.followed, []);
  assert.equal(await loadUnreadFollowedCount(), 0);
});

test("null latest falls back to at most the highest real chapter, never dated history beneath baseline", async (t) => {
  setup(t, { latest: [item("mt:ao")], details: [item("mt:ao", [chapter(147), chapter(146, OLD)])] });
  assert.deepEqual(numbers((await loadNewChapterFeed()).all), [147]);
  sourceService.getSeries = async () => item("mt:ao", [chapter(147, null, { baselineObserved: true, firstSeenAt: NOW - 1 }), chapter(146, OLD)]);
  assert.deepEqual((await loadNewChapterFeed()).all, []);
});

test("missing advertised chapter cannot fall back to historical chapters", async (t) => {
  setup(t, { latest: [item("mt:ao", [], 147)], details: [item("mt:ao", [chapter(146), chapter(145)])] });
  assert.deepEqual((await loadNewChapterFeed()).all, []);
});

test("pagination merges canonical variants once and preserves publication over newer detection", async (t) => {
  setup(t, { latest: [item("mt:ao", [], 147)], details: [item("mt:ao", [chapter(147, NOW - 5000)]), item("aq:ao", [chapter(147, null, { firstSeenAt: NOW - 1000 })])], read: [{ mangaId: "aq:ao", chapter: 147 }] });
  const first = await loadNewChapterFeed();
  sourceService.latest = async (source) => ({ items: source === "3asq" ? [item("aq:ao", [], 147)] : [], hasMore: false, page: 2 });
  const second = await loadNewChapterFeed(2);
  const groups = mergeChapterFeedPages([first, second], "all");
  assert.equal(groups.length, 1);
  assert.deepEqual(numbers(groups), [147]);
  assert.equal(groups[0].chapters[0].releaseAt, NOW - 5000);
  assert.equal(groups[0].chapters[0].releaseKind, "published");
  assert.equal(groups[0].chapters[0].read, true);
  assert.deepEqual(mergeChapterFeedPages([{ ...first, followed: first.all }, second], "followed"), []);
});

test("badge does not hydrate unrelated works or initialize their baselines", async (t) => {
  setup(t, { latest: [item("mt:other", [], 1, "Other Story")], details: [item("mt:other", [chapter(1)], 1, "Other Story")] });
  assert.equal(await loadUnreadFollowedCount(), 0);
  assert.equal(sourceService.getSeries.mock.callCount(), 0);
});

test("failed followed variant keeps tracking/read state and opens a readable source", async (t) => {
  setup(t, { latest: [item("aq:ao", [], 147)], followed: [{ mangaId: "mt:ao", trackingStartedAt: START }], details: [item("mt:ao"), item("aq:ao", [chapter(147)])], failed: ["mt:ao"], read: [{ mangaId: "mt:ao", chapter: 147 }] });
  const feed = await loadNewChapterFeed();
  assert.deepEqual(numbers(feed.followed), [147]);
  assert.equal(feed.followed[0].chapters[0].sourceKey, "aq:ao");
  assert.equal(feed.followed[0].chapters[0].read, true);
});

test("badge equals unread followed eligibility including followed-only works and canonical variants", async (t) => {
  setup(t, { latest: [item("aq:ao", [], 147)], followed: [{ mangaId: "mt:ao", trackingStartedAt: START }, { mangaId: "mt:other", trackingStartedAt: START }], details: [item("mt:ao", [chapter(147), chapter(146), chapter(145, OLD)]), item("aq:ao", [chapter(147)]), item("mt:other", [chapter(20)], null, "Other Story")], read: [{ mangaId: "aq:ao", chapter: 147 }] });
  const feed = await loadNewChapterFeed();
  const unread = feed.followed.flatMap((group) => group.chapters).filter((entry) => !entry.read).length;
  assert.equal(unread, 2);
  assert.equal(feed.unreadFollowedCount, unread);
  assert.equal(await loadUnreadFollowedCount(), unread);
});

function database(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(`CREATE TABLE source_items (source_key TEXT PRIMARY KEY, first_seen_at INTEGER);
    CREATE TABLE source_chapter_seen (source_key TEXT, chapter_identity TEXT, chapter_number REAL,
      published_at TEXT, first_seen_at INTEGER, is_baseline INTEGER, PRIMARY KEY (source_key, chapter_identity));`);
  return {
    prepare(query) {
      const statement = sql.prepare(query);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params); },
        async all() { return { results: statement.all(...params) }; },
        async run() { return statement.run(...params); },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

test("actual observation SQL preserves the whole baseline and stable new detection on refresh", async (t) => {
  const db = database(t);
  let now = START - 1000;
  t.mock.method(Date, "now", () => now);
  const baseline = item("mt:ao", Array.from({ length: 260 }, (_, i) => chapter(i + 1, null)));
  const first = await __test.rememberChapterAvailability(db, baseline);
  assert.equal(first.chapters.length, 260);
  assert.ok(first.chapters.every((entry) => entry.baselineObserved && entry.firstSeenAt === now));
  now = START + 1000;
  const next = await __test.rememberChapterAvailability(db, { ...baseline, chapters: [chapter(261, null), ...baseline.chapters] });
  assert.equal(next.chapters[0].baselineObserved, false);
  assert.equal(next.chapters[0].firstSeenAt, now);
  const detectedAt = now;
  now += 5000;
  const refreshed = await __test.rememberChapterAvailability(db, next);
  assert.equal(refreshed.chapters[0].firstSeenAt, detectedAt);
  assert.ok(refreshed.chapters.slice(1).every((entry) => entry.baselineObserved && entry.firstSeenAt === START - 1000));
  setup(t, { followed: [{ mangaId: "mt:ao", trackingStartedAt: START }], details: [refreshed] });
  const feed = await loadNewChapterFeed();
  assert.deepEqual(numbers(feed.followed), [261]);
  assert.equal(feed.followed[0].chapters[0].releaseAt, detectedAt);
});

test("list chapter extraction scopes source and work, preserves fractional and zero numbers", () => {
  const html = `<a href="/manga/ao/chapter-147/">147</a><a href="/manga/ao/146/">146</a>
    <a href="/manga/other/999/">999</a><a href="https://foreign.test/manga/ao/999/">999</a>`;
  assert.equal(latestLinkedChapter(html, "https://example.test/manga/ao/"), 147);
  assert.equal(latestLinkedChapter('<a href="/series/ao/14.5">14.5</a>', "https://example.test/series/ao"), 14.5);
  assert.equal(latestLinkedChapter('<a href="/series/ao/0">0</a>', "https://example.test/series/ao"), 0);
  assert.equal(latestLinkedChapter('<a href="/manga/ao/">Ao Ashi 2</a>', "https://example.test/manga/ao/"), null);
});

test("MangaTime latest route propagates actual latestChapter.number rather than chapterCount", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([{ result: { data: { json: { results: [{ id: "ao", slug: "ao", title: "Ao Ashi", chapterCount: 8, latestChapter: { number: 147 } }], hasMore: false } } } }]));
  const db = {
    prepare(query) { return { bind() { return this; }, async first() { return { user_id: "u" }; }, async all() { return { results: query.includes("table_info") ? [{ name: "first_seen_at" }] : [] }; }, async run() {} }; },
    async batch() {},
  };
  const response = await onRequestGet({ request: new Request("https://example.test/api/source/latest?source=mangatime", { headers: { Cookie: "anytime_session=test" } }), env: { DB: db } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].latest, 147);
});
