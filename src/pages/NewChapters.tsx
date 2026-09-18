import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { formatArabicRelativeTime } from "../services/dateFormat";
import {
  loadNewChapterFeed,
  type ChapterFeedGroup,
  type NewChapterFeed,
} from "../services/newChapters";

type Tab = "followed" | "all";

function mergeGroups(pages: NewChapterFeed[], kind: Tab) {
  const map = new Map<string, ChapterFeedGroup>();
  for (const page of pages) {
    const groups = kind === "followed" ? page.followed : page.all;
    for (const group of groups) {
      const existing = map.get(group.id);
      if (!existing) {
        map.set(group.id, { ...group, chapters: [...group.chapters] });
        continue;
      }
      const chapters = new Map(existing.chapters.map((chapter) => [chapter.identity, chapter]));
      for (const chapter of group.chapters) {
        const previous = chapters.get(chapter.identity);
        if (!previous || chapter.releaseAt > previous.releaseAt) {
          chapters.set(chapter.identity, chapter);
        }
      }
      existing.chapters = [...chapters.values()].sort(
        (a, b) => b.releaseAt - a.releaseAt || b.number - a.number,
      );
      existing.newestAt = existing.chapters[0]?.releaseAt ?? existing.newestAt;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.newestAt - a.newestAt || a.id.localeCompare(b.id),
  );
}

function FeedSkeleton() {
  return (
    <div className="new-feed-skeleton" aria-label="جاري تحميل الفصول">
      {Array.from({ length: 5 }, (_, index) => (
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
  const [tab, setTab] = useState<Tab>("followed");
  const [pages, setPages] = useState<NewChapterFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const followed = useMemo(() => mergeGroups(pages, "followed"), [pages]);
  const all = useMemo(() => mergeGroups(pages, "all"), [pages]);
  const groups = tab === "followed" ? followed : all;
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
          <p className="eyebrow">الفصول المتاحة الآن</p>
          <h1>جديد</h1>
        </div>
      </div>

      <div className="new-tabs" role="tablist" aria-label="أقسام الفصول الجديدة">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "followed"}
          className={tab === "followed" ? "active" : ""}
          onClick={() => setTab("followed")}
        >
          متابعتي
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          className={tab === "all" ? "active" : ""}
          onClick={() => setTab("all")}
        >
          الكل
        </button>
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
      ) : groups.length ? (
        <div className="new-feed">
          {groups.map((group) => (
            <article className="new-work-group" key={group.id}>
              <div className="new-work-head">
                <div className="new-cover">
                  <SourceCoverImage item={group.item} loading="lazy" alt="" />
                </div>
                <div className="new-work-title">
                  <h2 dir="auto">{group.item.title}</h2>
                  {group.chapters.length > 1 && (
                    <small>{group.chapters.length} فصول جديدة</small>
                  )}
                </div>
              </div>

              <div className="new-chapter-list">
                {group.chapters.map((chapter) => (
                  <Link
                    className="new-chapter-row"
                    key={chapter.identity}
                    to={"/read-source/" + encodeURIComponent(chapter.sourceKey) + "/" + chapter.number}
                  >
                    <span className={"new-dot " + (chapter.read ? "read" : "")} aria-hidden="true" />
                    <span className="new-chapter-copy">
                      <b>{chapter.title || "الفصل " + chapter.number}</b>
                      <small>{formatArabicRelativeTime(chapter.releaseAt)}</small>
                    </span>
                    <span className={chapter.read ? "chapter-state read" : "chapter-state"}>
                      {chapter.read ? "مقروء" : "غير مقروء"}
                    </span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="new-empty">
          {tab === "followed"
            ? "ما فيه فصول جديدة في متابعتك حاليًا."
            : "ما فيه فصول جديدة متاحة حاليًا."}
        </p>
      )}

      {error && pages.length > 0 && <p className="inline-error">{error}</p>}
      {!loading && hasMore && (
        <button className="secondary new-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "جاري التحميل…" : "تحميل المزيد"}
        </button>
      )}
    </section>
  );
}
