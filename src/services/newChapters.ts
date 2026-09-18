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

export function mergeChapterFeedPages(pages: NewChapterFeed[], kind: "followed" | "all") {
  // Followed is a complete snapshot on every load; only the all feed is paged.
  const incoming = (kind === "followed" ? pages.slice(-1) : pages).flatMap((page) => page[kind]);
  const canonical = mergeSourceItems(incoming.map((group) => group.item));
  const idByKey = new Map(canonical.flatMap((group) => group.items.map((item) => [item.key, group.id])));
  const merged = new Map<string, ChapterFeedGroup>();
  for (const group of incoming) {
    const id = idByKey.get(group.item.key)!;
    const previous = merged.get(id);
    if (!previous) {
      merged.set(id, { ...group, id, chapters: [...group.chapters] });
      continue;
    }
    const chapters = new Map(previous.chapters.map((chapter) => [chapter.identity, chapter]));
    for (const chapter of group.chapters) {
      const existing = chapters.get(chapter.identity);
      if (!existing) chapters.set(chapter.identity, chapter);
      else {
        const preferred = existing.releaseKind !== chapter.releaseKind
          ? (chapter.releaseKind === "published" ? chapter : existing)
          : (chapter.releaseAt < existing.releaseAt ? chapter : existing);
        chapters.set(chapter.identity, { ...preferred, read: existing.read || chapter.read });
      }
    }
    previous.sourceKeys = [...new Set([...previous.sourceKeys, ...group.sourceKeys])];
    previous.chapters = [...chapters.values()].sort((a, b) => b.releaseAt - a.releaseAt || b.number - a.number);
    previous.newestAt = previous.chapters[0].releaseAt;
  }
  return [...merged.values()].sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));
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
  // Keep unresolved variants: their keys still carry follow and read state.
  const items = details;
  return {
    ...group,
    primary: readable.find((item) => item.key === group.primary.key) ?? readable[0] ?? group.primary,
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
    // Earliest genuine publication is the canonical release. A later mirror's
    // upload/detection must not turn an already released chapter into a new one.
    const releaseAt = Math.min(...timingPool.map((version) => version.timestamp));
    const routeVersion = [...versions].sort((a, b) => {
      if (a.item.key === group.primary.key) return -1;
      if (b.item.key === group.primary.key) return 1;
      return a.item.key.localeCompare(b.item.key);
    })[0];
    const number = Number(routeVersion.chapter.number);
    const isRead = group.items.some((item) => read.has(readKey(item.key, number)));

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
    const numbers = new Set(group.items.flatMap((item) =>
      (item.chapters ?? []).map((chapter) => Number(chapter.number)).filter(Number.isFinite),
    ));
    for (const item of group.items) {
      for (const number of numbers) {
        const key = readKey(item.key, number);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ mangaId: item.key, chapter: number });
      }
    }
  }
  return pairs;
}

function latestIdentities(group: SourceGroup, latestBySourceKey: Map<string, number | null>, now: number) {
  const identities = new Set<string>();
  for (const item of group.items) {
    if (!latestBySourceKey.has(item.key)) continue;
    const latest = latestBySourceKey.get(item.key);
    const chapters = (item.chapters ?? []).filter((chapter) =>
      !chapter.synthetic && Number.isFinite(Number(chapter.number)),
    );
    // The list snapshot, never the hydrated series.latest, defines the update.
    // Without it, only the highest real chapter can qualify, and only if dated.
    const candidate = latest != null
      ? chapters.find((chapter) => Number(chapter.number) === latest)
      : [...chapters].sort((a, b) => b.number - a.number)[0];
    if (!candidate) continue;
    const release = releaseFor(candidate);
    if (release && release.timestamp <= now) identities.add(exactChapterIdentity(candidate));
  }
  return identities;
}

function selectChapters(group: ChapterFeedGroup, predicate: (chapter: FeedChapter) => boolean) {
  const chapters = group.chapters.filter(predicate);
  return chapters.length ? { ...group, chapters, newestAt: chapters[0].releaseAt } : null;
}

async function loadFeed(page: number, followedOnly = false): Promise<NewChapterFeed> {
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
  const latestBySourceKey = new Map(latestItems.map((item) => [
    item.key,
    item.latest != null && Number.isFinite(Number(item.latest)) ? Number(item.latest) : null,
  ]));

  const followedKeys = new Set(state.followed.map((entry) => entry.mangaId));
  // Badge requests need the same canonical variants but need not hydrate
  // unrelated latest works (or initialize their chapter baselines).
  const relevant = followedOnly
    ? allMerged.filter((group) => group.items.some((item) => followedKeys.has(item.key)))
    : allMerged;
  const hydrated = await mapWithConcurrency(relevant, 6, hydrateGroup);
  const readPairs = await userDataService.getReadChapterPairs(collectReadChecks(hydrated));
  const read = new Set(readPairs.map((entry) => readKey(entry.mangaId, entry.chapter)));
  const now = Date.now();

  const groups = hydrated
    .map((group) => groupChapters(group, state, read, now))
    .filter((group): group is ChapterFeedGroup => Boolean(group))
    .sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));

  const latestByGroup = new Map(hydrated.map((group) =>
    [group.id, latestIdentities(group, latestBySourceKey, now)],
  ));
  const all = groups
    .map((group) => selectChapters(group, (chapter) => latestByGroup.get(group.id)!.has(chapter.identity)))
    .filter((group): group is ChapterFeedGroup => group != null)
    .sort((a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id));

  const followed = groups
    .filter((group) => group.trackingStartedAt != null)
    .map((group) => selectChapters(group,
      (chapter) => chapter.releaseAt > Number(group.trackingStartedAt),
    ))
    .filter((group): group is ChapterFeedGroup => group != null)
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


export async function loadNewChapterFeed(page = 1): Promise<NewChapterFeed> {
  return loadFeed(page);
}

export async function loadUnreadFollowedCount() {
  // Share the same source variants, release precedence and exact read checks.
  return (await loadFeed(1, true)).unreadFollowedCount;
}
