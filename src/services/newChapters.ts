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

// Only sources whose chapter publication timestamps have been explicitly
// audited may enter the public New feed. Other sources remain available
// everywhere else in Wany until their date adapters are verified.
const VERIFIED_NEW_FEED_SOURCES: SourceName[] = ["3asq", "teamx", "mangalik", "mangatime", "xsano", "starzmanga", "azora"];

export const NEW_CHAPTER_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_NEW_CHAPTERS_PER_WORK = 5;
const VERIFIED_SOURCE_SCAN_PAGES: Partial<Record<SourceName, number>> = {
  "3asq": 2,
  teamx: 1,
  mangalik: 1,
  mangatime: 1,
  xsano: 1,
  starzmanga: 1,
  azora: 1,
};

export interface FeedChapter {
  identity: string;
  number: number;
  title: string;
  releaseAt: number;
  releaseKind: "published";
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

export interface NewFeedLoadProgress {
  completed: number;
  total: number;
  percent: number;
  label: string;
}

function parsePublished(value?: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function releaseFor(chapter: SourceChapter) {
  // The public "New" feed is intentionally strict: discovery time is not a
  // publication time. A chapter without a trustworthy upstream timestamp may
  // still be readable elsewhere in Wany, but it must not be advertised as a
  // release from the last 24 hours.
  const published = parsePublished(chapter.publishedAt);
  return published == null ? null : { timestamp: published, kind: "published" as const };
}

function readKey(mangaId: string, chapter: number) {
  return `${mangaId}:${chapter}`;
}

function exactChapterIdentity(chapter: SourceChapter) {
  const number = Number(chapter.number);
  return Number.isFinite(number) ? String(number) : chapter.title.trim();
}

async function withinSourceBudget<T>(promise: Promise<T>, milliseconds = 7500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SOURCE_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    Array<{ item: SourceManga; chapter: SourceChapter; timestamp: number; kind: "published" }>
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
    // When several sources carry the same chapter, use the earliest verified
    // publication timestamp. Re-scrapes and late source discovery therefore
    // cannot make an old chapter look new again.
    const releaseAt = Math.min(...versions.map((version) => version.timestamp));
    // Route through the version whose own verified publication time matches
    // the canonical (earliest) release. This avoids linking a merged feed row
    // to a late mirror that may list the chapter but cannot actually open it.
    const routeVersion = [...versions].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
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
      releaseKind: "published",
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

export async function loadNewChapterFeed(
  page = 1,
  onProgress?: (progress: NewFeedLoadProgress) => void,
): Promise<NewChapterFeed> {
  const safePage = Math.max(1, Math.min(20, Math.trunc(page)));
  const sourceTasks = VERIFIED_NEW_FEED_SOURCES.flatMap((source) => {
    const pagesPerFeedPage = VERIFIED_SOURCE_SCAN_PAGES[source] ?? 1;
    const scanStart = (safePage - 1) * pagesPerFeedPage + 1;
    return Array.from({ length: pagesPerFeedPage }, (_, index) => ({
      source,
      page: scanStart + index,
    }));
  });

  // Progress is tied to real completed work: personalization + every source
  // request + final read-state merge. No timer or fake interpolation.
  const totalSteps = sourceTasks.length + 2;
  let completedSteps = 0;
  const report = (label: string) => {
    onProgress?.({
      completed: completedSteps,
      total: totalSteps,
      percent: Math.min(100, Math.round((completedSteps / totalSteps) * 100)),
      label,
    });
  };
  report("بدء فحص المصادر");

  const personalizationPromise = userDataService.getPersonalizationState().finally(() => {
    completedSteps += 1;
    report("تم تجهيز حسابك");
  });

  const latestPromise = Promise.allSettled(
    sourceTasks.map(({ source, page: sourcePage }) =>
      withinSourceBudget(sourceService.recent(source, sourcePage)).finally(() => {
        completedSteps += 1;
        report("جاري جمع أحدث الفصول");
      }),
    ),
  );

  const [state, latestSettled] = await Promise.all([
    personalizationPromise,
    latestPromise,
  ]);

  const latestItemsByKey = new Map<string, SourceManga>();
  for (const result of latestSettled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.items) latestItemsByKey.set(item.key, item);
  }
  const latestItems = [...latestItemsByKey.values()];
  const hasMore = latestSettled.some(
    (result) => result.status === "fulfilled" && result.value.hasMore,
  );
  // Latest adapters already return the chapter rows needed by the public
  // feed. Do not re-open every series here: that turns one lightweight latest
  // request into N detail requests and is the main source of page latency.
  const latestGroups = mergeSourceItems(latestItems);
  const readPairs = await userDataService.getReadChapterPairs(collectReadChecks(latestGroups));
  const read = new Set(readPairs.map((entry) => readKey(entry.mangaId, entry.chapter)));
  completedSteps += 1;
  report("اكتمل التحديث");
  const now = Date.now();

  const groups = latestGroups
    .map((group) => groupChapters(group, state, read, now))
    .filter((group): group is ChapterFeedGroup => Boolean(group))
    .sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));

  const cutoff = now - NEW_CHAPTER_WINDOW_MS;
  const all = groups
    .map((group) => ({
      ...group,
      // A bulk release must not flood the public New feed. The chapter list is
      // already sorted newest-first after cross-source deduplication, so cap
      // each work only after applying the strict 24-hour publication window.
      chapters: group.chapters
        .filter((chapter) => chapter.releaseAt > cutoff)
        .slice(0, MAX_NEW_CHAPTERS_PER_WORK),
    }))
    .filter((group) => group.chapters.length > 0)
    .map((group) => ({
      ...group,
      newestAt: group.chapters[0].releaseAt,
    }))
    .sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));

  const followed = all
    .filter((group) => group.trackingStartedAt != null)
    .map((group) => ({
      ...group,
      chapters: group.chapters.filter(
        (chapter) =>
          chapter.releaseAt > Number(group.trackingStartedAt) &&
          !chapter.read,
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


