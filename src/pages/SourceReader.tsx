// Production reader deploy marker: Team-X images use the chapter referer path.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { parseSourceGroupKeys } from "../services/sourceMerge";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { readerPath, sourceKeyFromReaderPath } from "../services/readerPaths";
import { readerChapterWindow } from "../services/readerNavigation";
import { sourceService } from "../services/sources";
import { saveWorkSnapshot } from "../services/workSnapshots";
import type { SourceChapterPayload } from "../types";

const INITIAL_READER_PAGES = 2;
const READER_PRELOAD_MARGIN_FAST = "1600px 0px";
const READER_PRELOAD_MARGIN_SLOW = "700px 0px";
const PROGRESS_SAVE_DELAY_MS = 60 * 1000;
const PROGRESS_MIN_DELTA = 3;
const PROGRESS_NOOP_DELTA = 0.25;
const READER_IMAGE_RETRY_DELAYS_MS = [900, 2200] as const;
type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function readerConnection() {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as NavigatorWithConnection).connection;
}

function readerIsSlowConnection() {
  const connection = readerConnection();
  return Boolean(
    connection?.saveData ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g"
  );
}

function readerConcurrency() {
  if (readerIsSlowConnection()) return 2;
  return readerConnection()?.effectiveType === "4g" ? 4 : 3;
}

function readerPreloadMargin() {
  return readerIsSlowConnection() ? READER_PRELOAD_MARGIN_SLOW : READER_PRELOAD_MARGIN_FAST;
}

export function SourceReader() {
  const { key = "", source = "", work = "", chapter = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceKey = key ? decodeURIComponent(key) : sourceKeyFromReaderPath(source, work);
  const sourceKeys = parseSourceGroupKeys(searchParams.get("sources"), sourceKey);
  const sourceGroupSignature = sourceKeys.join("|");
  const exactChapterUrl = searchParams.get("chapterUrl")?.trim() || undefined;
  const number = Number(chapter);
  const [payload, setPayload] = useState<SourceChapterPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadChapter = async () => {
      setLoading(true);
      setError("");
      setPayload(null);

      try {
        const result = await sourceService.getChapter(sourceKey, number, exactChapterUrl);
        if (active) setPayload(result);
        return;
      } catch (primaryCause) {
        const candidates = sourceKeys.length ? sourceKeys : [sourceKey];

        for (const fallbackKey of candidates) {
          if (!fallbackKey || fallbackKey === sourceKey) continue;

          try {
            const fallback = await sourceService.getChapter(fallbackKey, number);
            if (!active) return;

            // Switch the URL to the source that actually served the chapter.
            // This keeps progress, navigation and image referers tied to the
            // working source instead of silently mixing source identities.
            navigate(readerPath(fallback.item, fallback.number, candidates), {
              replace: true,
            });
            return;
          } catch {
            // The next merged source gets its own chance.
          }
        }

        if (active) {
          setError(
            primaryCause instanceof Error
              ? primaryCause.message
              : "تعذر تحميل الفصل.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadChapter();

    return () => {
      active = false;
    };
  }, [sourceKey, number, exactChapterUrl, navigate, sourceGroupSignature]);

  if (!Number.isFinite(number)) {
    return (
      <main className="page">
        <Link to="/discover">العودة للاستكشاف →</Link>
        <h1>رقم الفصل غير صالح</h1>
      </main>
    );
  }

  if (loading)
    return (
      <main className="reader source-reader-loading">
        <div className="loading">جاري تحميل صفحات الفصل…</div>
      </main>
    );

  if (!payload || error)
    return (
      <main className="page">
        <Link to={`/source/${encodeURIComponent(sourceKey)}`}>العودة للفصول →</Link>
        <h1>تعذر فتح الفصل</h1>
        <p className="error source-error">{error || "الفصل غير متاح."}</p>
      </main>
    );

  return (
    <ReaderChapter
      key={`${sourceKey}:${number}:${exactChapterUrl ?? ""}`}
      sourceKey={sourceKey}
      sourceKeys={sourceKeys}
      payload={payload}
      legacyPath={Boolean(key)}
    />
  );
}

function ReaderChapter({
  sourceKey,
  sourceKeys,
  payload,
  legacyPath,
}: {
  sourceKey: string;
  sourceKeys: string[];
  payload: SourceChapterPayload;
  legacyPath: boolean;
}) {
  const { data, saveProgress, recordChapterOpen, markChaptersRead } = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const chapter = payload.number;
  const saved = data?.progress[`${sourceKey}:${chapter}`]?.percent ?? 0;
  const [percent, setPercent] = useState(saved);
  const saveRef = useRef(saveProgress);

  useEffect(() => {
    if (!legacyPath) return;
    navigate(
      readerPath(
        payload.item,
        chapter,
        sourceKeys,
        payload.chapterUrl ?? undefined,
      ),
      { replace: true },
    );
  }, [chapter, legacyPath, navigate, payload.item]);

  useEffect(() => {
    // iOS can keep a native form control in an editable/focused state and then
    // surface "Undo Typing" on shake even when the reader has no text field.
    // Drop any carried focus as soon as the chapter reader opens.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  }, [chapter]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRootBackground = root.style.background;
    const previousBodyBackground = body.style.background;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = themeMeta?.content ?? "";

    root.classList.add("reader-edge-to-edge");
    body.classList.add("reader-edge-to-edge");
    root.style.background = "transparent";
    body.style.background = "transparent";
    if (themeMeta) themeMeta.content = "#17191b";

    return () => {
      root.classList.remove("reader-edge-to-edge");
      body.classList.remove("reader-edge-to-edge");
      root.style.background = previousRootBackground;
      body.style.background = previousBodyBackground;
      if (themeMeta) themeMeta.content = previousTheme;
    };
  }, []);
  const restoredRef = useRef(false);
  const initialPageCount = Math.min(INITIAL_READER_PAGES, payload.pages.length);
  const initialPageIndexes = Array.from({ length: initialPageCount }, (_, index) => index);
  const requestedRef = useRef<Set<number>>(new Set(initialPageIndexes));
  const loadedRef = useRef<Set<number>>(new Set());
  const activeRef = useRef<Set<number>>(new Set(initialPageIndexes));
  const queueRef = useRef<number[]>([]);
  const retryCountRef = useRef<Map<number, number>>(new Map());
  const retryPendingRef = useRef<Set<number>>(new Set());
  const retryTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const maxConcurrentRef = useRef(readerConcurrency());
  const [requestedPages, setRequestedPages] = useState<Set<number>>(
    () => new Set(initialPageIndexes),
  );
  const [retryVersions, setRetryVersions] = useState<Map<number, number>>(
    () => new Map(),
  );
  // Some Team-X chapters append a broken trailing canvas after the real pages.
  // Collapse it only after all normal image retries fail, not on a transient error.
  const [failedTrailingTeamXPage, setFailedTrailingTeamXPage] = useState(false);
  const trailingTeamXIndex = payload.item.source === "teamx" ? payload.pages.length - 1 : -1;
  const prefetchedNextRef = useRef<number | null>(null);
  const nextPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markedUnreadRef = useRef(false);
  saveRef.current = saveProgress;

  useEffect(() => {
    void recordChapterOpen(sourceKey, chapter);
  }, [chapter, recordChapterOpen, sourceKey]);

  useEffect(() => {
    void saveWorkSnapshot(payload.item, chapter);
  }, [chapter, payload.item]);

  const pumpImageQueue = useCallback(() => {
    let changed = false;
    while (
      activeRef.current.size < maxConcurrentRef.current &&
      queueRef.current.length
    ) {
      const nextIndex = queueRef.current.shift();
      if (nextIndex == null || requestedRef.current.has(nextIndex)) continue;
      requestedRef.current.add(nextIndex);
      activeRef.current.add(nextIndex);
      changed = true;
    }
    if (changed) setRequestedPages(new Set(requestedRef.current));
  }, []);

  const requestPage = useCallback(
    (index: number) => {
      if (
        index < 0 ||
        index >= payload.pages.length ||
        requestedRef.current.has(index) ||
        retryPendingRef.current.has(index) ||
        queueRef.current.includes(index)
      ) {
        return;
      }
      queueRef.current.push(index);
      pumpImageQueue();
    },
    [payload.pages.length, pumpImageQueue],
  );

  const retryPage = useCallback(
    (index: number) => {
      const retryCount = retryCountRef.current.get(index) ?? 0;
      if (retryCount >= READER_IMAGE_RETRY_DELAYS_MS.length) {
        retryPendingRef.current.delete(index);
        return;
      }

      retryPendingRef.current.delete(index);
      retryCountRef.current.set(index, retryCount + 1);
      setRetryVersions((current) => {
        const next = new Map(current);
        next.set(index, (next.get(index) ?? 0) + 1);
        return next;
      });
      requestPage(index);
    },
    [requestPage],
  );

  const schedulePageRetry = useCallback(
    (index: number) => {
      const retryCount = retryCountRef.current.get(index) ?? 0;
      if (retryCount >= READER_IMAGE_RETRY_DELAYS_MS.length) return false;

      retryPendingRef.current.add(index);
      const existingTimer = retryTimersRef.current.get(index);
      if (existingTimer) {
        clearTimeout(existingTimer);
        retryTimersRef.current.delete(index);
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return true;
      }

      const timer = setTimeout(() => {
        retryTimersRef.current.delete(index);
        retryPage(index);
      }, READER_IMAGE_RETRY_DELAYS_MS[retryCount]);

      retryTimersRef.current.set(index, timer);
      return true;
    },
    [retryPage],
  );

  const settlePage = useCallback(
    (index: number, loaded: boolean) => {
      activeRef.current.delete(index);

      if (loaded) {
        loadedRef.current.add(index);
        retryPendingRef.current.delete(index);
        retryCountRef.current.delete(index);
        const timer = retryTimersRef.current.get(index);
        if (timer) {
          clearTimeout(timer);
          retryTimersRef.current.delete(index);
        }

        if (!restoredRef.current && index < INITIAL_READER_PAGES) {
          window.dispatchEvent(new Event("resize"));
        }
      } else if (schedulePageRetry(index)) {
        // Remove the failed page from the requested set so the same <img> can
        // receive its src again on the bounded retry attempt.
        requestedRef.current.delete(index);
        setRequestedPages(new Set(requestedRef.current));
      } else if (index === trailingTeamXIndex && index > 0) {
        // Never leave a full-height broken image after the actual chapter.
        // Keep an explicit retry action in case the upstream image was temporary.
        setFailedTrailingTeamXPage(true);
      }

      pumpImageQueue();
    },
    [pumpImageQueue, schedulePageRetry, trailingTeamXIndex],
  );

  useEffect(() => {
    const retryUnsettledPages = () => {
      const candidates = new Set([
        ...retryPendingRef.current,
        ...requestedRef.current,
      ]);

      for (const index of candidates) {
        if (loadedRef.current.has(index)) continue;

        const timer = retryTimersRef.current.get(index);
        if (timer) {
          clearTimeout(timer);
          retryTimersRef.current.delete(index);
        }

        retryPendingRef.current.delete(index);
        activeRef.current.delete(index);
        requestedRef.current.delete(index);
        queueRef.current = queueRef.current.filter((queued) => queued !== index);
        retryPage(index);
      }

      setRequestedPages(new Set(requestedRef.current));
      pumpImageQueue();
    };

    const retryWhenVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) {
        retryUnsettledPages();
      }
    };

    window.addEventListener("online", retryUnsettledPages);
    window.addEventListener("focus", retryUnsettledPages);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.removeEventListener("online", retryUnsettledPages);
      window.removeEventListener("focus", retryUnsettledPages);
      document.removeEventListener("visibilitychange", retryWhenVisible);
      for (const timer of retryTimersRef.current.values()) clearTimeout(timer);
      retryTimersRef.current.clear();
      retryPendingRef.current.clear();
    };
  }, [pumpImageQueue, retryPage]);

  const navigation = readerChapterWindow(
    payload.item.chapters ?? [], chapter, payload.chapterUrl, payload.item.url,
  );
  const chapterOptions = navigation.options;
  const selectedChapterIndex = navigation.selectedIndex;
  const selectedChapter = chapterOptions[selectedChapterIndex];
  const previousChapter = navigation.previous?.number ?? payload.previous;
  const nextChapter = navigation.next?.number ?? payload.next;
  const imageReferer =
    payload.item.source === "teamx"
      ? selectedChapter?.url || `${payload.item.url.replace(/\/$/, "")}/${chapter}`
      : payload.item.source === "3asq" || payload.item.source === "starzmanga" || payload.item.source === "xsano" || payload.item.source === "mangalik" || payload.item.source === "azora"
        ? payload.chapterUrl || selectedChapter?.url || payload.item.url
        : undefined;
  const displayTitle = sourceDisplayTitle(payload.item);
  const enteredFromReader = Boolean(
    (location.state as { readerNavigation?: boolean } | null)?.readerNavigation,
  );
  const previousUnreadChapters = data
    ? (payload.item.chapters ?? [])
        .map((entry) => Number(entry.number))
        .filter(
          (entryNumber) =>
            entryNumber < chapter &&
            !data.completed.includes(`${sourceKey}:${entryNumber}`),
        )
        .sort((a, b) => a - b)
    : [];
  const [catchupDismissed, setCatchupDismissed] = useState(false);
  const [catchupBusy, setCatchupBusy] = useState(false);
  const showCatchupPrompt =
    Boolean(data) &&
    payload.item.chapterListComplete !== false &&
    !enteredFromReader &&
    !catchupDismissed &&
    previousUnreadChapters.length > 0;

  const acceptCatchup = async () => {
    if (catchupBusy || !previousUnreadChapters.length) return;
    setCatchupBusy(true);
    try {
      // Keep requests bounded while still supporting long-running series.
      for (let index = 0; index < previousUnreadChapters.length; index += 500) {
        await markChaptersRead(
          sourceKey,
          previousUnreadChapters.slice(index, index + 500),
        );
      }
      setCatchupDismissed(true);
    } finally {
      setCatchupBusy(false);
    }
  };

  const readerNavigationState = { readerNavigation: true };

  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let ready = false;
    let timer: ReturnType<typeof setTimeout>;
    let restoreTimer: ReturnType<typeof setTimeout>;
    let latest = saved;
    let lastPersisted = saved;
    let completionFlushed = saved >= 98;

    const persist = (force = false) => {
      if (markedUnreadRef.current) return;
      const delta = Math.abs(latest - lastPersisted);
      if (delta < PROGRESS_NOOP_DELTA) return;
      if (!force && latest < 98 && delta < PROGRESS_MIN_DELTA) return;
      lastPersisted = latest;
      void saveRef.current({
        mangaId: sourceKey,
        chapter,
        percent: latest,
        updatedAt: Date.now(),
      });
    };

    const restore = () => {
      if (restoredRef.current) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0 && payload.pages.length) {
        restoreTimer = setTimeout(restore, 180);
        return;
      }
      window.scrollTo(0, (Math.max(0, max) * saved) / 100);
      restoredRef.current = true;
      ready = true;
    };

    restoreTimer = setTimeout(restore, 120);

    const scroll = () => {
      if (!ready) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      latest = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      setPercent(latest);
      clearTimeout(timer);

      if (latest >= 98 && !completionFlushed) {
        completionFlushed = true;
        persist(true);
        return;
      }

      timer = setTimeout(() => persist(false), PROGRESS_SAVE_DELAY_MS);
    };

    const hidden = () => {
      if (document.visibilityState === "hidden") persist(true);
    };

    const pageHide = () => persist(true);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", hidden);

    return () => {
      clearTimeout(timer);
      clearTimeout(restoreTimer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("visibilitychange", hidden);
      if (ready) persist(true);
      history.scrollRestoration = previousRestoration;
      restoredRef.current = false;
    };
  }, [sourceKey, chapter, payload.pages.length]);

  useEffect(() => {
    if (nextChapter == null || prefetchedNextRef.current === nextChapter) return;

    // Keep D1/source traffic conservative: prefetch only one adjacent chapter,
    // and only when the reader is likely to need it. Slow/data-saver links wait
    // until the reader is near the end; fast links can warm it a little earlier.
    const threshold = readerIsSlowConnection() ? 90 : 65;
    if (percent < threshold) return;

    const next = nextChapter;
    prefetchedNextRef.current = next;
    const run = () => {
      void sourceService.getChapter(sourceKey, next, navigation.next?.url).catch(() => {
        if (prefetchedNextRef.current === next) prefetchedNextRef.current = null;
      });
    };

    nextPrefetchTimerRef.current = setTimeout(run, readerIsSlowConnection() ? 350 : 80);
    return () => {
      if (nextPrefetchTimerRef.current) clearTimeout(nextPrefetchTimerRef.current);
      nextPrefetchTimerRef.current = null;
    };
  }, [percent, nextChapter, navigation.next?.url, sourceKey]);

  return (
    <main className="reader source-reader">
      <header className="reader-header">
        <Link to={`/source/${encodeURIComponent(sourceKey)}`} aria-label="العودة إلى صفحة القصة">
          <Icon name="back" />
        </Link>
        <div className="reader-heading">
          <small dir="auto">{displayTitle}</small>
          <div className="reader-chapter-controls">
            {previousChapter != null ? (
              <Link className="reader-chapter-step" to={readerPath(
                payload.item,
                previousChapter,
                sourceKeys,
                navigation.previous?.url,
              )} state={readerNavigationState}>السابق</Link>
            ) : (
              <span className="reader-chapter-step is-disabled">السابق</span>
            )}
            <select
              className="reader-chapter-select"
              value={selectedChapterIndex >= 0 ? String(selectedChapterIndex) : "current"}
              aria-label="اختيار الفصل"
              onChange={(event) => {
                const target = event.currentTarget;
                const entry = chapterOptions[Number(target.value)];
                target.blur();
                if (!entry) return;
                navigate(
                  readerPath(
                    payload.item,
                    entry.number,
                    sourceKeys,
                    entry.url,
                  ),
                  { state: readerNavigationState },
                );
              }}
            >
              {chapterOptions.length ? chapterOptions.map((entry, index) => (
                <option
                  key={entry.url || `${entry.number}:${entry.title}:${index}`}
                  value={index}
                >
                  {entry.title || `الفصل ${entry.number}`}
                </option>
              )) : <option value="current">الفصل {chapter}</option>}
            </select>
            {nextChapter != null ? (
              <Link className="reader-chapter-step" to={readerPath(
                payload.item,
                nextChapter,
                sourceKeys,
                navigation.next?.url,
              )} state={readerNavigationState}>التالي</Link>
            ) : (
              <span className="reader-chapter-step is-disabled">التالي</span>
            )}
          </div>
        </div>
      </header>

      {showCatchupPrompt && (
        <div
          className="reader-catchup-confirm"
          role="alertdialog"
          aria-label="تعليم الفصول السابقة كمقروءة"
        >
          <div>
            <strong>هل قرأت الفصول السابقة؟</strong>
            <span>
              هل تريد اعتبار جميع الفصول قبل الفصل {chapter} مقروءة؟
              {" "}({previousUnreadChapters.length} فصل)
            </span>
          </div>
          <div className="reader-catchup-actions">
            <button
              className="secondary"
              type="button"
              disabled={catchupBusy}
              onClick={() => setCatchupDismissed(true)}
            >
              رفض
            </button>
            <button
              className="primary"
              type="button"
              disabled={catchupBusy}
              onClick={() => void acceptCatchup()}
            >
              {catchupBusy ? "جاري التحديث…" : "موافقة"}
            </button>
          </div>
        </div>
      )}

      <div className="reader-panels source-pages">
        {payload.pages.map((page, index) => (
          failedTrailingTeamXPage && index === trailingTeamXIndex ? null : <ProgressiveReaderPage
            key={`${index}:${page}`}
            index={index}
            src={sourceService.imageUrl(payload.item.source, page, imageReferer)}
            retryVersion={retryVersions.get(index) ?? 0}
            alt={`${displayTitle} - الفصل ${chapter} - صفحة ${index + 1}`}
            shouldLoad={requestedPages.has(index)}
            onNear={requestPage}
            onSettled={settlePage}
          />
        ))}
      </div>
      {failedTrailingTeamXPage && (
        <button
          className="secondary"
          type="button"
          onClick={() => {
            retryCountRef.current.delete(trailingTeamXIndex);
            requestedRef.current.delete(trailingTeamXIndex);
            loadedRef.current.delete(trailingTeamXIndex);
            setRequestedPages(new Set(requestedRef.current));
            setRetryVersions((current) => {
              const next = new Map(current);
              next.set(trailingTeamXIndex, (next.get(trailingTeamXIndex) ?? 0) + 1);
              return next;
            });
            setFailedTrailingTeamXPage(false);
            requestPage(trailingTeamXIndex);
          }}
        >
          إعادة محاولة تحميل الصورة الأخيرة
        </button>
      )}

      <footer className="reader-end">
        <p className="eyebrow">نهاية الفصل {chapter}</p>
        <div className="reader-links">
          {previousChapter != null ? (
            <Link
              className="secondary"
              to={readerPath(
                payload.item,
                previousChapter,
                sourceKeys,
                navigation.previous?.url,
              )}
              state={readerNavigationState}
            >
              الفصل السابق →
            </Link>
          ) : (
            <span>هذا أول فصل</span>
          )}
          {nextChapter != null ? (
            <Link
              className="primary"
              to={readerPath(
                payload.item,
                nextChapter,
                sourceKeys,
                navigation.next?.url,
              )}
              state={readerNavigationState}
            >
              ← الفصل التالي
            </Link>
          ) : (
            <Link className="primary" to={`/source/${encodeURIComponent(sourceKey)}`}>
              العودة للفصول
            </Link>
          )}
        </div>
      </footer>
    </main>
  );
}


function ProgressiveReaderPage({
  index,
  src,
  alt,
  retryVersion,
  shouldLoad,
  onNear,
  onSettled,
}: {
  index: number;
  src: string;
  alt: string;
  retryVersion: number;
  shouldLoad: boolean;
  onNear: (index: number) => void;
  onSettled: (index: number, loaded: boolean) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const retrySrc = retryVersion > 0
    ? `${src}${src.includes("?") ? "&" : "?"}wany_retry=${retryVersion}`
    : src;

  useEffect(() => {
    if (shouldLoad) return;
    const image = imageRef.current;
    if (!image) return;

    if (typeof IntersectionObserver === "undefined") {
      onNear(index);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onNear(index);
        observer.disconnect();
      },
      { rootMargin: readerPreloadMargin() },
    );

    observer.observe(image);
    return () => observer.disconnect();
  }, [index, onNear, shouldLoad]);

  return (
    <img
      ref={imageRef}
      src={shouldLoad ? retrySrc : undefined}
      alt={alt}
      loading={index < INITIAL_READER_PAGES ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={index === 0 ? "high" : index === 1 ? "auto" : "low"}
      onLoad={() => onSettled(index, true)}
      onError={() => onSettled(index, false)}
    />
  );
}
