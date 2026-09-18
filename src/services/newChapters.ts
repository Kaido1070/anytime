import type {
  PersonalizationState,
  ReadChapterPair,
  SourceChapter,
  SourceManga,
  SourceName,
} from "../types";
import { mergeSourceItems, preferredSourceCover, type SourceGroup } from "./sourceMerge";
import { sourceService } from "./sources";
import { userDataService } from "./userData";

const SOURCES: SourceName[] = [
  "mangatime",
  "teamx",
  "3asq",
  "starzmanga",
  "xsano",
  "mangalik",
];

export interface FeedChapter {
  identity: string;
  number: number;
  title: string;
  releaseAt: number;
  releaseKind: "published" | "first_seen";
  read: boolean;
  sourceKey: string;
}

export interface ChapterFeedGroup {
  id: string;
  item: SourceManga;
  sourceKeys: string[];
  trackingStartedAt: number | null;
  chapters: FeedChapter[];
  newestAt: number;
}

export interface NewChapterFeed {
  followed: ChapterFeedGroup[];
  all: ChapterFeedGroup[];
  unreadFollowedCount: number;
  hasMore: boolean;
  page: number;
}

function parsePublished(value?: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function releaseFor(chapter: SourceChapter) {
  const published = parsePublished(chapter.publishedAt);
  if (published != null) {
    return { timestamp: published, kind: "published" as const };
  }
  if (chapter.baselineObserved) return null;
  const firstSeen = Number(chapter.firstSeenAt);
  if (Number.isFinite(firstSeen) && firstSeen > 0) {
    return { timestamp: firstSeen, kind: "first_seen" as const };
  }
  return null;
}

function readKey(mangaId: string, chapter: number) {
  return `${mangaId}:${chapter}`;
}

function exactChapterIdentity(chapter: SourceChapter) {
  const number = Number(chapter.number);
  return Number.isFinite(number) ? String(number) : chapter.title.trim();
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) break;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveInChunks(keys: string[]) {
  const unique = [...new Set(keys)].filter(sourceService.isSourceKey);
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 60) {
    chunks.push(unique.slice(index, index + 60));
  }
  const results = await Promise.allSettled(chunks.map((chunk) => sourceService.resolve(chunk)));
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function hydrateGroup(group: SourceGroup) {
  const details = await mapWithConcurrency(group.items, 3, async (item) => {
    try {
      return await sourceService.getSeries(item.key);
    } catch {
      return item;
    }
  });
  const readable = details.filter((item) => (item.chapters?.length ?? 0) > 0);
  const items = readable.length ? readable : details;
  return {
    ...group,
    primary: items.find((item) => item.key === group.primary.key) ?? items[0] ?? group.primary,
    items,
  };
}

function groupChapters(
  group: SourceGroup,
  state: PersonalizationState,
  read: Set<string>,
  now: number,
) {
  const trackingRows = state.followed.filter((entry) =>
    group.items.some((item) => item.key === entry.mangaId),
  );
  const trackingStartedAt = trackingRows.length
    ? Math.min(...trackingRows.map((entry) => entry.trackingStartedAt))
    : null;

  const byIdentity = new Map<
    string,
    Array<{ item: SourceManga; chapter: SourceChapter; timestamp: number; kind: "published" | "first_seen" }>
  >();

  for (const item of group.items) {
    for (const chapter of item.chapters ?? []) {
      if (chapter.synthetic) continue;
      const release = releaseFor(chapter);
      const number = Number(chapter.number);
      if (!release || !Number.isFinite(number) || release.timestamp > now) continue;
      const identity = exactChapterIdentity(chapter);
      const current = byIdentity.get(identity) ?? [];
      current.push({
        item,
        chapter,
        timestamp: release.timestamp,
        kind: release.kind,
      });
      byIdentity.set(identity, current);
    }
  }

  const chapters: FeedChapter[] = [];
  for (const [identity, versions] of byIdentity) {
    const realPublished = versions.filter((version) => version.kind === "published");
    const timingPool = realPublished.length ? realPublished : versions;
    const releaseAt = Math.min(...timingPool.map((version) => version.timestamp));
    const routeVersion = [...versions].sort((a, b) => {
      if (a.item.key === group.primary.key) return -1;
      if (b.item.key === group.primary.key) return 1;
      return a.item.key.localeCompare(b.item.key);
    })[0];
    const number = Number(routeVersion.chapter.number);
    const isRead = versions.some((version) => read.has(readKey(version.item.key, number)));

    chapters.push({
      identity,
      number,
      title: routeVersion.chapter.title || `الفصل ${number}`,
      releaseAt,
      releaseKind: realPublished.length ? "published" : "first_seen",
      read: isRead,
      sourceKey: routeVersion.item.key,
    });
  }

  chapters.sort((a, b) => b.releaseAt - a.releaseAt || b.number - a.number || a.identity.localeCompare(b.identity));
  if (!chapters.length) return null;

  const cover = preferredSourceCover(group.items) ?? group.primary;
  return {
    id: group.id,
    item: { ...group.primary, cover: cover.cover },
    sourceKeys: group.items.map((item) => item.key),
    trackingStartedAt,
    chapters,
    newestAt: chapters[0].releaseAt,
  } satisfies ChapterFeedGroup;
}

function collectReadChecks(groups: SourceGroup[]) {
  const pairs: ReadChapterPair[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      for (const chapter of item.chapters ?? []) {
        const number = Number(chapter.number);
        if (!Number.isFinite(number)) continue;
        const key = readKey(item.key, number);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ mangaId: item.key, chapter: number });
      }
    }
  }
  return pairs;
}

export async function loadNewChapterFeed(page = 1): Promise<NewChapterFeed> {
  const safePage = Math.max(1, Math.min(20, Math.trunc(page)));
  const [state, latestSettled] = await Promise.all([
    userDataService.getPersonalizationState(),
    Promise.allSettled(SOURCES.map((source) => sourceService.latest(source, safePage))),
  ]);

  const latestItems = latestSettled.flatMap((result) =>
    result.status === "fulfilled" ? result.value.items : [],
  );
  const hasMore = latestSettled.some(
    (result) => result.status === "fulfilled" && result.value.hasMore,
  );
  const followedItems = await resolveInChunks(state.followed.map((entry) => entry.mangaId));
  const allMerged = mergeSourceItems([...latestItems, ...followedItems]);
  const latestKeys = new Set(latestItems.map((item) => item.key));
  const relevant = allMerged.filter((group) =>
    group.items.some((item) => latestKeys.has(item.key)),
  );

  const hydrated = await mapWithConcurrency(relevant, 6, hydrateGroup);
  const readPairs = await userDataService.getReadChapterPairs(collectReadChecks(hydrated));
  const read = new Set(readPairs.map((entry) => readKey(entry.mangaId, entry.chapter)));
  const now = Date.now();

  const groups = hydrated
    .map((group) => groupChapters(group, state, read, now))
    .filter((group): group is ChapterFeedGroup => Boolean(group))
    .sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));

  const all = groups.map((group) => ({
    ...group,
    chapters: group.chapters.slice(0, 8),
  }));

  const followed = groups
    .filter((group) => group.trackingStartedAt != null)
    .map((group) => ({
      ...group,
      chapters: group.chapters.filter(
        (chapter) => chapter.releaseAt > Number(group.trackingStartedAt),
      ),
    }))
    .filter((group) => group.chapters.length > 0)
    .sort((a, b) => b.chapters[0].releaseAt - a.chapters[0].releaseAt || a.id.localeCompare(b.id));

  return {
    followed,
    all,
    unreadFollowedCount: followed.reduce(
      (sum, group) => sum + group.chapters.filter((chapter) => !chapter.read).length,
      0,
    ),
    hasMore,
    page: safePage,
  };
}


export async function loadUnreadFollowedCount() {
  const state = await userDataService.getPersonalizationState();
  if (!state.followed.length) return 0;

  const followedItems = await resolveInChunks(state.followed.map((entry) => entry.mangaId));
  const merged = mergeSourceItems(followedItems);
  const hydrated = await mapWithConcurrency(merged, 6, hydrateGroup);
  const readPairs = await userDataService.getReadChapterPairs(collectReadChecks(hydrated));
  const read = new Set(readPairs.map((entry) => readKey(entry.mangaId, entry.chapter)));
  const now = Date.now();

  return hydrated.reduce((total, group) => {
    const feed = groupChapters(group, state, read, now);
    if (!feed || feed.trackingStartedAt == null) return total;
    return total + feed.chapters.filter(
      (chapter) =>
        chapter.releaseAt > Number(feed.trackingStartedAt) &&
        !chapter.read,
    ).length;
  }, 0);
}
