import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { formatArabicRelativeTime } from "../services/dateFormat";
import {
  loadNewChapterFeed,
  type ChapterFeedGroup,
  type FeedChapter,
  type NewChapterFeed,
} from "../services/newChapters";

interface FlatChapterEntry {
  key: string;
  group: ChapterFeedGroup;
  chapter: FeedChapter;
}

function mergeChapters(pages: NewChapterFeed[]) {
  const entries = new Map<string, FlatChapterEntry>();

  for (const page of pages) {
    for (const group of page.all) {
      for (const chapter of group.chapters) {
        const key = `${group.id}:${chapter.identity}`;
        const existing = entries.get(key);
        if (!existing || chapter.releaseAt > existing.chapter.releaseAt) {
          entries.set(key, { key, group, chapter });
        }
      }
    }
  }

  return [...entries.values()].sort(
    (a, b) =>
      b.chapter.releaseAt - a.chapter.releaseAt ||
      b.chapter.number - a.chapter.number ||
      a.key.localeCompare(b.key),
  );
}

function FeedSkeleton() {
  return (
    <div className="new-feed-skeleton" aria-label="جاري تحميل الفصول">
      {Array.from({ length: 7 }, (_, index) => (
        <div className="new-skeleton-row" key={index}>
          <span className="skeleton-cover" />
          <span className="skeleton-lines">
            <i />
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}

export function NewChapters() {
  const [pages, setPages] = useState<NewChapterFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const chapters = useMemo(() => mergeChapters(pages), [pages]);
  const hasMore = pages.at(-1)?.hasMore ?? false;
  const nextPage = (pages.at(-1)?.page ?? 0) + 1;

  useEffect(() => {
    const saved = Number(sessionStorage.getItem("wany:new:scroll") ?? 0);
    let active = true;
    setLoading(true);
    setError("");

    loadNewChapterFeed(1)
      .then((feed) => {
        if (!active) return;
        setPages([feed]);
        requestAnimationFrame(() => window.scrollTo(0, saved));
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "تعذر تحميل الفصول الجديدة.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sessionStorage.setItem("wany:new:scroll", String(window.scrollY));
    };
  }, []);

  async function retry() {
    setLoading(true);
    setError("");
    try {
      setPages([await loadNewChapterFeed(1)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الفصول الجديدة.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const feed = await loadNewChapterFeed(nextPage);
      setPages((current) => [...current, feed]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المزيد.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="new-page">
      <div className="page-intro new-intro">
        <div>
          <p className="eyebrow">آخر 24 ساعة</p>
          <h1>جديد</h1>
          <p className="muted">أحدث الفصول من جميع المصادر، مرتبة من الأحدث إلى الأقدم.</p>
        </div>
      </div>

      {loading ? (
        <FeedSkeleton />
      ) : error && !pages.length ? (
        <div className="new-error" role="alert">
          <p>{error}</p>
          <button className="secondary" type="button" onClick={() => void retry()}>
            إعادة المحاولة
          </button>
        </div>
      ) : chapters.length ? (
        <div className="new-feed new-flat-feed">
          {chapters.map(({ key, group, chapter }) => (
            <Link
              className="new-flat-row"
              key={key}
              to={"/read-source/" + encodeURIComponent(chapter.sourceKey) + "/" + chapter.number}
            >
              <span className="new-flat-cover" aria-hidden="true">
                <SourceCoverImage item={group.item} loading="lazy" alt="" />
              </span>

              <span className="new-flat-copy">
                <strong dir="auto">{group.item.title}</strong>
                <b>{chapter.title || "الفصل " + chapter.number}</b>
                <small>{formatArabicRelativeTime(chapter.releaseAt)}</small>
              </span>

              <span className={chapter.read ? "chapter-state read" : "chapter-state"}>
                {chapter.read ? "مقروء" : "جديد"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="new-empty">ما نزلت فصول جديدة خلال آخر 24 ساعة.</p>
      )}

      {error && pages.length > 0 && <p className="inline-error">{error}</p>}
      {!loading && hasMore && (
        <button
          className="secondary new-load-more"
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "جاري البحث عن فصول أحدث…" : "فحص المزيد من المصادر"}
        </button>
      )}
    </section>
  );
}
