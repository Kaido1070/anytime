import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { useLibrary } from "../hooks/useLibrary";
import {
  FYP_INITIAL_COUNT,
  FYP_LOAD_MORE_COUNT,
  RECOMMENDATION_ALGORITHM_VERSION,
  RECOMMENDATION_CACHE_TTL_MS,
  RECOMMENDATION_WEIGHTS as W,
} from "../services/recommendationConfig";
import {
  rankRecommendations,
  type RankedRecommendation,
  type RecommendationCandidate,
  type TasteSignal,
  type TasteSignalKind,
} from "../services/recommendations";
import {
  mergeSourceItems,
  preferredSourceCover,
  sourceDetailsPath,
  type SourceGroup,
} from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import { userDataService } from "../services/userData";
import type {
  LibraryEntry,
  PersonalizationState,
  SourceManga,
  SourceName,
  UserData,
  UserListDetail,
} from "../types";

const SOURCES: SourceName[] = [
  "mangatime",
  "teamx",
  "3asq",
  "starzmanga",
  "xsano",
  "mangalik",
];

interface FypSnapshot {
  generatedAt: number;
  algorithmVersion: string;
  tasteSignature: string;
  coldStart: boolean;
  recommendations: RankedRecommendation[];
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

async function resolveInChunks(
  keys: string[],
  onProgress?: (completed: number, total: number) => void,
) {
  const unique = [...new Set(keys)].filter(sourceService.isSourceKey);
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 60) {
    chunks.push(unique.slice(index, index + 60));
  }
  let completed = 0;
  const settled = await Promise.allSettled(
    chunks.map((chunk) => sourceService.resolve(chunk).finally(() => {
      completed += 1;
      onProgress?.(completed, chunks.length);
    })),
  );
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

function signalKind(
  key: string,
  entry: LibraryEntry | undefined,
  favorite: Set<string>,
  listKeys: Set<string>,
  reading: PersonalizationState["readingWorks"][number] | undefined,
): TasteSignalKind {
  if (favorite.has(key)) return "favorite";
  if (entry?.status === "completed") return "completed";
  if (entry?.status === "reading") return "reading";
  if (listKeys.has(key)) return "list";
  if (entry?.status === "planned") return "planned";
  return reading ? "history" : "planned";
}

function signalWeight(
  key: string,
  item: SourceManga,
  entry: LibraryEntry | undefined,
  favorite: Set<string>,
  listKeys: Set<string>,
  reading: PersonalizationState["readingWorks"][number] | undefined,
  now: number,
) {
  let weight = 0;
  if (favorite.has(key)) weight += W.favorite;
  if (entry?.status === "completed") weight += W.completed;
  if (entry?.status === "reading") weight += W.reading;
  if (entry?.status === "planned") weight += W.planned;
  if (entry?.status === "paused") weight += W.paused;
  if (listKeys.has(key)) weight += W.list;

  if (reading) {
    const maxChapter =
      item.latest ??
      Math.max(
        0,
        ...(item.chapters ?? []).map((chapter) => Number(chapter.number)).filter(Number.isFinite),
      );
    if (maxChapter > 0 && reading.highestChapter != null) {
      const progress = Math.max(0, Math.min(1, reading.highestChapter / maxChapter));
      weight += progress > 0 ? W.shallowRead + progress * W.deepReadMax : 0;
    } else if (reading.readCount > 0) {
      weight += Math.min(1.5, W.shallowRead + reading.readCount / 20);
    }

    if (reading.lastReadAt != null) {
      const age = now - reading.lastReadAt;
      if (age <= 7 * 86_400_000) weight += W.recentSevenDays;
      else if (age <= 30 * 86_400_000) weight += W.recentThirtyDays;
      else if (age <= 90 * 86_400_000) weight += W.recentNinetyDays;
    }
  }

  return Math.max(-W.perWorkCap, Math.min(W.perWorkCap, weight));
}

function snapshotKey(userId: string) {
  return "wany:fyp:" + userId + ":" + RECOMMENDATION_ALGORITHM_VERSION;
}

function readSnapshot(userId: string, signature: string): FypSnapshot | null {
  try {
    const raw = sessionStorage.getItem(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FypSnapshot;
    if (
      parsed.algorithmVersion !== RECOMMENDATION_ALGORITHM_VERSION ||
      parsed.tasteSignature !== signature ||
      Date.now() - parsed.generatedAt > RECOMMENDATION_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(userId: string, snapshot: FypSnapshot) {
  try {
    sessionStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
  } catch {
    // D1 remains authoritative; the cache is optional.
  }
}

async function loadLists(onProgress?: (completed: number, total: number) => void) {
  const summaries = await userDataService.getLists();
  let completed = 0;
  const settled = await Promise.allSettled(
    summaries.map((summary) => userDataService.getList(summary.id).finally(() => {
      completed += 1;
      onProgress?.(completed, summaries.length);
    })),
  );
  onProgress?.(summaries.length, summaries.length);
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

function buildTasteSignature(
  data: UserData,
  state: PersonalizationState,
  lists: UserListDetail[],
) {
  const favorite = [...data.favorites].sort().join(",");
  const library = [...data.library]
    .sort((a, b) => a.mangaId.localeCompare(b.mangaId))
    .map((entry) => entry.mangaId + ":" + entry.status + ":" + (entry.highestReachedChapter ?? ""))
    .join(",");
  const listItems = lists
    .flatMap((list) => list.items.map((item) => item.mangaId))
    .sort()
    .join(",");
  const reading = [...state.readingWorks]
    .sort((a, b) => a.mangaId.localeCompare(b.mangaId))
    .map((entry) => entry.mangaId + ":" + entry.readCount + ":" + (entry.highestChapter ?? ""))
    .join(",");
  return [favorite, library, listItems, reading].join("|");
}

async function hydrateSignalItems(
  items: SourceManga[],
  onProgress?: (completed: number, total: number) => void,
) {
  let completed = 0;
  return mapWithConcurrency(items, 6, async (item) => {
    try {
      return await sourceService.getSeries(item.key);
    } catch {
      return item;
    } finally {
      completed += 1;
      onProgress?.(completed, items.length);
    }
  });
}

async function hydrateCandidate(group: SourceGroup) {
  const ordered = [group.primary, ...group.items.filter((item) => item.key !== group.primary.key)];
  let best: SourceManga | null = null;
  for (const item of ordered.slice(0, 3)) {
    try {
      const detail = await sourceService.getSeries(item.key);
      if ((detail.chapters?.length ?? 0) > 0) {
        best = detail;
        break;
      }
      best ??= detail;
    } catch {
      // Try the next source for the same canonical work.
    }
  }
  if (!best || !(best.chapters?.length ?? 0)) return null;
  const cover = preferredSourceCover([best, ...group.items]) ?? best;
  if (!cover.cover) return null;
  return {
    item: { ...best, cover: cover.cover, chapters: undefined },
    sourceKeys: group.items.map((item) => item.key),
  };
}

async function buildFyp(
  data: UserData,
  userId: string,
  onProgress?: (percent: number) => void,
) {
  // A progress milestone means the work behind it is completed. Never move backwards.
  let lastReported = 0;
  const report = (percent: number) => {
    const next = Math.max(1, Math.min(100, Math.round(percent * 10) / 10));
    if (next > lastReported) {
      lastReported = next;
      onProgress?.(next);
    }
  };
  report(1);
  const [state, lists] = await Promise.all([
    userDataService.getPersonalizationState().then((value) => {
      report(8);
      return value;
    }),
    loadLists((completed, total) => report(8 + (completed / Math.max(1, total)) * 12)),
  ]);
  report(20);
  const signature = buildTasteSignature(data, state, lists);
  const cached = readSnapshot(userId, signature);
  if (cached) {
    report(100);
    return cached;
  }

  const favorite = new Set(data.favorites);
  const listKeys = new Set(lists.flatMap((list) => list.items.map((item) => item.mangaId)));
  const libraryByKey = new Map(data.library.map((entry) => [entry.mangaId, entry]));
  const readingByKey = new Map(state.readingWorks.map((entry) => [entry.mangaId, entry]));
  const knownKeys = new Set([
    ...favorite,
    ...listKeys,
    ...libraryByKey.keys(),
    ...readingByKey.keys(),
  ]);

  const knownBase = await resolveInChunks([...knownKeys], (completed, total) =>
    report(20 + (completed / Math.max(1, total)) * 12),
  );
  report(32);
  const priority = [...knownBase].sort((a, b) => {
    const wa =
      (favorite.has(a.key) ? W.favorite : 0) +
      (libraryByKey.get(a.key)?.status === "completed" ? W.completed : 0) +
      (readingByKey.get(a.key)?.lastReadAt ?? 0) / 1e14;
    const wb =
      (favorite.has(b.key) ? W.favorite : 0) +
      (libraryByKey.get(b.key)?.status === "completed" ? W.completed : 0) +
      (readingByKey.get(b.key)?.lastReadAt ?? 0) / 1e14;
    return wb - wa || a.key.localeCompare(b.key);
  });
  const signalItems = await hydrateSignalItems(priority.slice(0, 48), (completed, total) =>
    report(32 + (completed / Math.max(1, total)) * 16),
  );
  report(48);
  const now = Date.now();
  const signals: TasteSignal[] = signalItems.flatMap((item) => {
    const entry = libraryByKey.get(item.key);
    const reading = readingByKey.get(item.key);
    const weight = signalWeight(
      item.key,
      item,
      entry,
      favorite,
      listKeys,
      reading,
      now,
    );
    if (weight <= 0) return [];
    return [{
      item,
      weight,
      kind: signalKind(item.key, entry, favorite, listKeys, reading),
      lastReadAt: reading?.lastReadAt ?? null,
    }];
  });

  // Advance from completed network operations, never a decorative timer.
  const sourceRequestTotal = SOURCES.length * 2;
  let completedSourceRequests = 0;
  const trackSourceRequest = <T,>(request: Promise<T>): Promise<T> =>
    request.finally(() => {
      completedSourceRequests += 1;
      report(48 + (completedSourceRequests / sourceRequestTotal) * 25);
    });
  const sourcePairs = await Promise.allSettled(
    SOURCES.flatMap((source) => [
      trackSourceRequest(sourceService.latest(source, 1).then((result) => ({ mode: "latest" as const, result }))),
      trackSourceRequest(sourceService.popular(source, 1).then((result) => ({ mode: "popular" as const, result }))),
    ]),
  );
  const items: SourceManga[] = [];
  const popularity = new Map<string, number>();
  const freshness = new Map<string, number>();

  for (const settled of sourcePairs) {
    if (settled.status !== "fulfilled") continue;
    const { mode, result } = settled.value;
    result.items.forEach((item, index) => {
      items.push(item);
      const value = Math.max(0, 1 - index / Math.max(1, result.items.length));
      const map = mode === "popular" ? popularity : freshness;
      map.set(item.key, Math.max(map.get(item.key) ?? 0, value));
    });
  }

  const merged = mergeSourceItems([...knownBase, ...items]);
  const candidateGroups = merged
    .filter((group) => !group.items.some((item) => knownKeys.has(item.key)))
    .map((group) => ({
      group,
      popularity: Math.max(...group.items.map((item) => popularity.get(item.key) ?? 0), 0),
      freshness: Math.max(...group.items.map((item) => freshness.get(item.key) ?? 0), 0),
    }))
    .sort(
      (a, b) =>
        b.popularity + b.freshness - (a.popularity + a.freshness) ||
        a.group.id.localeCompare(b.group.id),
    )
    .slice(0, 72);

  let hydratedCandidates = 0;
  const hydrated = await mapWithConcurrency(candidateGroups, 6, async (candidate) => {
    try {
      const work = await hydrateCandidate(candidate.group);
      if (!work) return null;
      return {
        ...work,
        popularity: candidate.popularity,
        freshness: candidate.freshness,
      } satisfies RecommendationCandidate;
    } finally {
      hydratedCandidates += 1;
      report(73 + (hydratedCandidates / Math.max(1, candidateGroups.length)) * 25);
    }
  });
  report(98);

  const candidates: RecommendationCandidate[] = hydrated.filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
  );
  const recommendations = rankRecommendations(candidates, signals);
  const snapshot: FypSnapshot = {
    generatedAt: Date.now(),
    algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
    tasteSignature: signature,
    coldStart: signals.length === 0,
    recommendations,
  };
  writeSnapshot(userId, snapshot);
  report(100);
  return snapshot;
}

function FypProgress({ percent }: { percent: number }) {
  // Smooth only towards completed work. Never invent progress while a request waits.
  const [displayed, setDisplayed] = useState(1);
  const targetRef = useRef(1);
  targetRef.current = Math.max(1, Math.min(100, percent));

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(targetRef.current);
    }
  }, [percent]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setDisplayed((current) => Math.min(targetRef.current, current + 1));
    }, 45);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="new-progress-card fyp-progress-card" aria-busy="true">
      <div
        className="new-progress-ring fyp-progress-ring"
        style={{ "--new-progress": displayed.toFixed(1) + "%" } as CSSProperties}
        role="progressbar"
        aria-label="تقدم تجهيز الاقتراحات"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(displayed)}
      >
        <div className="new-progress-ring-core">
          <strong>{Math.floor(displayed)}%</strong>
        </div>
      </div>
      <div className="new-progress-copy">
        <b>جاري تجهيز اقتراحاتك</b>
        <small>ستظهر القصص فور اكتمال التحميل</small>
      </div>
    </div>
  );
}

export function Fyp() {
  const { user, data } = useLibrary();
  const location = useLocation();
  const returnState = { returnTo: `${location.pathname}${location.search}${location.hash}` };
  const [snapshot, setSnapshot] = useState<FypSnapshot | null>(null);
  const [visibleCount, setVisibleCount] = useState(FYP_INITIAL_COUNT);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(1);
  const [error, setError] = useState("");

  const visible = useMemo(
    () => snapshot?.recommendations.slice(0, visibleCount) ?? [],
    [snapshot, visibleCount],
  );

  useEffect(() => {
    if (!user || !data) return;
    const saved = Number(sessionStorage.getItem("wany:fyp:scroll") ?? 0);
    let active = true;
    setLoading(true);
    setProgress(1);
    setError("");
    buildFyp(data, user.id, (percent) => {
      if (active) setProgress((current) => Math.max(current, percent));
    })
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        requestAnimationFrame(() => window.scrollTo(0, saved));
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "تعذر تجهيز اقتراحاتك.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sessionStorage.setItem("wany:fyp:scroll", String(window.scrollY));
    };
  }, [user?.id, data]);

  async function retry() {
    if (!user || !data) return;
    sessionStorage.removeItem(snapshotKey(user.id));
    setLoading(true);
    setProgress(1);
    setError("");
    try {
      setSnapshot(await buildFyp(data, user.id, (percent) =>
        setProgress((current) => Math.max(current, percent)),
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تجهيز اقتراحاتك.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="fyp-page">
      <div className="page-intro fyp-intro">
        <p className="eyebrow">مقترح لك</p>
        <h1>FYP</h1>
        {snapshot?.coldStart && (
          <p className="muted fyp-cold-start">
            ابدأ القراءة وسنضبط الاقتراحات حسب ذوقك.
          </p>
        )}
      </div>

      {loading ? (
        <FypProgress percent={progress} />
      ) : error ? (
        <div className="new-error" role="alert">
          <p>{error}</p>
          <button className="secondary" type="button" onClick={() => void retry()}>
            إعادة المحاولة
          </button>
        </div>
      ) : visible.length ? (
        <>
          <div className="fyp-list">
            {visible.map((recommendation) => (
              <article className="fyp-card" key={recommendation.item.key}>
                <Link
                  className="fyp-cover"
                  to={sourceDetailsPath(recommendation.item.key, recommendation.sourceKeys)} state={returnState}
                  aria-label={"فتح " + recommendation.item.title}
                >
                  <SourceCoverImage item={recommendation.item} loading="lazy" alt="" />
                </Link>
                <div className="fyp-copy">
                  <Link to={sourceDetailsPath(recommendation.item.key, recommendation.sourceKeys)} state={returnState}>
                    <h2 dir="auto">{recommendation.item.title}</h2>
                  </Link>
                  <div className="fyp-tags">
                    {[recommendation.item.type, ...(recommendation.item.genres ?? [])]
                      .filter(Boolean)
                      .filter((value, index, list) => list.indexOf(value) === index)
                      .slice(0, 3)
                      .map((value) => <span key={value}>{value}</span>)}
                  </div>
                  <p className="fyp-reason">{recommendation.reason}</p>
                  <Link
                    className="secondary fyp-open"
                    to={sourceDetailsPath(recommendation.item.key, recommendation.sourceKeys)} state={returnState}
                  >
                    فتح القصة
                  </Link>
                </div>
              </article>
            ))}
          </div>

          {snapshot && visibleCount < snapshot.recommendations.length && (
            <button
              className="secondary fyp-load-more"
              type="button"
              onClick={() => setVisibleCount((current) => current + FYP_LOAD_MORE_COUNT)}
            >
              تحميل المزيد
            </button>
          )}
        </>
      ) : (
        <p className="new-empty">ما وجدنا اقتراحات بجودة كافية حاليًا.</p>
      )}
    </section>
  );
}
