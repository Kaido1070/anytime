// Production reader deploy marker: Team-X images use the chapter referer path.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon, Progress } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import type { SourceChapterPayload } from "../types";

const INITIAL_READER_PAGES = 2;
const READER_PRELOAD_MARGIN = "1400px 0px";
const PROGRESS_SAVE_DELAY_MS = 60 * 1000;
const PROGRESS_MIN_DELTA = 3;
const PROGRESS_NOOP_DELTA = 0.25;
const READER_PROGRESS_VISIBILITY_KEY = "wany:reader-progress-visible";

function readerProgressVisible() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(READER_PROGRESS_VISIBILITY_KEY) !== "false";
}

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function readerConcurrency() {
  if (typeof navigator === "undefined") return 2;
  const connection = (navigator as NavigatorWithConnection).connection;
  if (
    connection?.saveData ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g"
  ) {
    return 2;
  }
  return connection?.effectiveType === "4g" ? 3 : 2;
}

export function SourceReader() {
  const { key = "", chapter = "" } = useParams();
  const sourceKey = decodeURIComponent(key);
  const number = Number(chapter);
  const [payload, setPayload] = useState<SourceChapterPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPayload(null);
    sourceService
      .getChapter(sourceKey, number)
      .then((result) => active && setPayload(result))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "تعذر تحميل الفصل."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [sourceKey, number]);

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
        <div className="loading">جاري جلب صفحات الفصل من المصدر…</div>
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

  return <ReaderChapter key={`${sourceKey}:${number}`} sourceKey={sourceKey} payload={payload} />;
}

function ReaderChapter({
  sourceKey,
  payload,
}: {
  sourceKey: string;
  payload: SourceChapterPayload;
}) {
  const { data, saveProgress, recordChapterOpen, markChapterUnread } = useLibrary();
  const chapter = payload.number;
  const saved = data?.progress[`${sourceKey}:${chapter}`]?.percent ?? 0;
  const [percent, setPercent] = useState(saved);
  const [showProgress] = useState(readerProgressVisible);
  const saveRef = useRef(saveProgress);
  const restoredRef = useRef(false);
  const initialPageCount = Math.min(INITIAL_READER_PAGES, payload.pages.length);
  const initialPageIndexes = Array.from({ length: initialPageCount }, (_, index) => index);
  const requestedRef = useRef<Set<number>>(new Set(initialPageIndexes));
  const activeRef = useRef<Set<number>>(new Set(initialPageIndexes));
  const queueRef = useRef<number[]>([]);
  const maxConcurrentRef = useRef(readerConcurrency());
  const [requestedPages, setRequestedPages] = useState<Set<number>>(
    () => new Set(initialPageIndexes),
  );
  const prefetchedNextRef = useRef<number | null>(null);
  const markedUnreadRef = useRef(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  saveRef.current = saveProgress;

  useEffect(() => {
    void recordChapterOpen(sourceKey, chapter);
  }, [chapter, recordChapterOpen, sourceKey]);

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
        queueRef.current.includes(index)
      ) {
        return;
      }
      queueRef.current.push(index);
      pumpImageQueue();
    },
    [payload.pages.length, pumpImageQueue],
  );

  const settlePage = useCallback(
    (index: number, loaded: boolean) => {
      activeRef.current.delete(index);
      pumpImageQueue();
      if (loaded && !restoredRef.current && index < INITIAL_READER_PAGES) {
        window.dispatchEvent(new Event("resize"));
      }
    },
    [pumpImageQueue],
  );

  const selectedChapter = payload.item.chapters?.find(
    (entry) => Number(entry.number) === Number(chapter),
  );
  const imageReferer =
    payload.item.source === "teamx"
      ? selectedChapter?.url || `${payload.item.url.replace(/\/$/, "")}/${chapter}`
      : payload.item.source === "3asq" || payload.item.source === "starzmanga" || payload.item.source === "xsano" || payload.item.source === "mangalik"
        ? selectedChapter?.url || payload.item.url
        : undefined;
  const displayTitle = sourceDisplayTitle(payload.item);

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
    if (percent < 75 || payload.next == null || prefetchedNextRef.current === payload.next) {
      return;
    }
    prefetchedNextRef.current = payload.next;
    void sourceService.getChapter(sourceKey, payload.next).catch(() => {
      if (prefetchedNextRef.current === payload.next) prefetchedNextRef.current = null;
    });
  }, [percent, payload.next, sourceKey]);

  const handleMarkUnread = async () => {
    if (markingUnread) return;
    markedUnreadRef.current = true;
    setMarkingUnread(true);
    try {
      await markChapterUnread(sourceKey, chapter);
      setPercent(0);
    } catch {
      markedUnreadRef.current = false;
    } finally {
      setMarkingUnread(false);
    }
  };

  return (
    <main className="reader source-reader">
      <header className="reader-header">
        <Link to={`/source/${encodeURIComponent(sourceKey)}`} aria-label="العودة إلى صفحة القصة">
          <Icon name="back" />
        </Link>
        <div>
          <small dir="auto">{displayTitle}</small>
          <h1>الفصل {chapter}</h1>
        </div>
        <button
          className="reader-unread"
          type="button"
          disabled={markingUnread}
          onClick={() => void handleMarkUnread()}
        >
          {markingUnread ? "جاري…" : "غير مقروء"}
        </button>
        {showProgress && <span>{Math.round(percent)}%</span>}
      </header>

      <div className="reader-panels source-pages">
        {payload.pages.map((page, index) => (
          <ProgressiveReaderPage
            key={`${index}:${page}`}
            index={index}
            src={sourceService.imageUrl(payload.item.source, page, imageReferer)}
            alt={`${displayTitle} - الفصل ${chapter} - صفحة ${index + 1}`}
            shouldLoad={requestedPages.has(index)}
            onNear={requestPage}
            onSettled={settlePage}
          />
        ))}
      </div>

      <footer className="reader-end">
        <p className="eyebrow">نهاية الفصل {chapter}</p>
        <h2>جاهز تكمل؟</h2>
        <div className="reader-links">
          {payload.previous != null ? (
            <Link
              className="secondary"
              to={`/read-source/${encodeURIComponent(sourceKey)}/${payload.previous}`}
            >
              الفصل السابق →
            </Link>
          ) : (
            <span>هذا أول فصل</span>
          )}
          {payload.next != null ? (
            <Link
              className="primary"
              to={`/read-source/${encodeURIComponent(sourceKey)}/${payload.next}`}
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

      {showProgress && (
        <div className="reader-progress" aria-label={`تقدم القراءة ${Math.round(percent)}%`}>
          <Progress value={percent} />
          <span>{Math.round(percent)}%</span>
        </div>
      )}
    </main>
  );
}


function ProgressiveReaderPage({
  index,
  src,
  alt,
  shouldLoad,
  onNear,
  onSettled,
}: {
  index: number;
  src: string;
  alt: string;
  shouldLoad: boolean;
  onNear: (index: number) => void;
  onSettled: (index: number, loaded: boolean) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);

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
      { rootMargin: READER_PRELOAD_MARGIN },
    );

    observer.observe(image);
    return () => observer.disconnect();
  }, [index, onNear, shouldLoad]);

  return (
    <img
      ref={imageRef}
      src={shouldLoad ? src : undefined}
      alt={alt}
      loading="eager"
      decoding="async"
      fetchPriority={index === 0 ? "high" : "auto"}
      onLoad={() => onSettled(index, true)}
      onError={() => onSettled(index, false)}
    />
  );
}
