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

const SOURCE_LABELS: Record<SourceName, string> = {
  mangatime: "MangaTime",
  teamx: "TeamX",
  "3asq": "3asq",
  starzmanga: "StarzManga",
  xsano: "XSano",
  mangalik: "MangaLik",
  azora: "Azora",
};

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
  sourceLabel: string;
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

const NEW_SOURCE_BUDGET_MS: Partial<Record<SourceName, number>> = {
  mangatime: 20_000,
  starzmanga: 15_000,
  mangalik: 15_000,
  xsano: 20_000,
  azora: 20_000,
};

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

function saudiDayKey(timestamp: number) {
  return new Date(timestamp + 3 * 60 * 60_000).toISOString().slice(0, 10);
}

function mergeLatestWithHistory(latest: SourceManga[], history: SourceManga[]) {
  const byKey = new Map<string, SourceManga>();

  for (const item of [...history, ...latest]) {
    const existing = byKey.get(item.key);
    if (!existing) {
      byKey.set(item.key, {
        ...item,
        chapters: [...(item.chapters ?? [])],
      });
      continue;
    }

    const chapterMap = new Map<string, SourceChapter>();
    for (const chapter of [...(existing.chapters ?? []), ...(item.chapters ?? [])]) {
      const identity = exactChapterIdentity(chapter);
      const current = chapterMap.get(identity);
      if (!current) {
        chapterMap.set(identity, chapter);
        continue;
      }

      const currentAt = parsePublished(current.publishedAt);
      const candidateAt = parsePublished(chapter.publishedAt);
      if (candidateAt != null && (currentAt == null || candidateAt < currentAt)) {
        chapterMap.set(identity, { ...current, ...chapter, publishedAt: chapter.publishedAt });
      }
    }

    byKey.set(item.key, {
      ...existing,
      ...item,
      chapters: [...chapterMap.values()],
    });
  }

  return [...byKey.values()];
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
  for (const [identity, rawVersions] of byIdentity) {
    // Keep one canonical timestamp per source. If a source was observed more
    // than once, its earliest verified publication timestamp wins.
    const bySource = new Map<string, (typeof rawVersions)[number]>();
    for (const version of rawVersions) {
      const current = bySource.get(version.item.key);
      if (!current || version.timestamp < current.timestamp) {
        bySource.set(version.item.key, version);
      }
    }

    const versions = [...bySource.values()];
    const firstReleaseAt = Math.min(...versions.map((version) => version.timestamp));
    const firstReleaseDay = saudiDayKey(firstReleaseAt);

    // A mirror posting the same chapter on a later calendar day is not New.
    // If several sources release it on the original day, keep each source so
    // the reader can explicitly choose which source to follow.
    const sameDayVersions = versions
      .filter((version) => saudiDayKey(version.timestamp) === firstReleaseDay)
      .sort((a, b) => a.timestamp - b.timestamp || a.item.key.localeCompare(b.item.key));

    for (const version of sameDayVersions) {
      const number = Number(version.chapter.number);
      chapters.push({
        identity,
        number,
        title: version.chapter.title || `الفصل ${number}`,
        releaseAt: version.timestamp,
        releaseKind: "published",
        read: read.has(readKey(version.item.key, number)),
        sourceKey: version.item.key,
        sourceLabel: SOURCE_LABELS[version.item.source] ?? version.item.source,
      });
    }
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
  const totalSteps = sourceTasks.length + 3;
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
      withinSourceBudget(
        sourceService.recent(source, sourcePage),
        NEW_SOURCE_BUDGET_MS[source] ?? 7500,
      ).finally(() => {
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

  const chapterNumbers = [...new Set(
    latestItems.flatMap((item) =>
      (item.chapters ?? [])
        .filter((chapter) => Boolean(chapter.publishedAt))
        .map((chapter) => Number(chapter.number))
        .filter(Number.isFinite),
    ),
  )];

  let historyItems: SourceManga[] = [];
  try {
    const history = await withinSourceBudget(
      sourceService.releaseHistory(chapterNumbers),
      7500,
    );
    historyItems = history.items;
  } catch {
    // History improves cross-source deduplication but must never block New.
  }
  completedSteps += 1;
  report("تمت مقارنة الفصول بين المصادر");

  // Historical rows are only used to decide the chapter's original release
  // day. The current source payload remains authoritative for title/cover/url.
  const comparableItems = mergeLatestWithHistory(latestItems, historyItems);
  const latestGroups = mergeSourceItems(comparableItems);
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


