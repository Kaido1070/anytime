import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ListManager } from "../components/ListManager";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { Back, Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { parseSourceGroupKeys, preferredSourceCover, sourceDetailsPath } from "../services/sourceMerge";
import { getContinueChapter } from "../services/reading";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { readerPath } from "../services/readerPaths";
import { formatGregorianDate } from "../services/dateFormat";
import { sourceService } from "../services/sources";
import { saveWorkSnapshot } from "../services/workSnapshots";
import type { LibraryStatus, SourceManga } from "../types";

const CHAPTERS_PER_PAGE = 100;

function ChapterPagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;

  return (
    <nav className="chapter-pagination" aria-label="صفحات الفصول">
      <button
        className="secondary"
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        السابق
      </button>

      <label className="chapter-page-select">
        <span>صفحة</span>
        <select
          value={page}
          onChange={(event) => onPage(Number(event.target.value))}
          aria-label="اختيار صفحة الفصول"
        >
          {Array.from({ length: pages }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <span>من {pages}</span>
      </label>

      <button
        className="secondary"
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        التالي
      </button>
    </nav>
  );
}

function statusLabel(status?: string) {
  switch (status) {
    case "completed": return "مكتمل";
    case "ongoing": return "مستمر";
    case "hiatus": return "متوقف";
    case "cancelled": return "متروك";
    default: return "غير محدد";
  }
}

export function SourceMangaDetails() {
  const { key = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || "/discover";
  const sourceKey = decodeURIComponent(key);
  const sourceGroupParam = searchParams.get("sources");
  const requestedSourceKeys = parseSourceGroupKeys(sourceGroupParam, sourceKey);
  const requestedSourceSignature = requestedSourceKeys.join("|");
  const { data, favorite, addToLibrary, setLibraryStatus, saveProgress, markChapterUnread, markWorkUnread, markChaptersRead } = useLibrary();
  const [item, setItem] = useState<SourceManga | null>(null);
  const [sourceOptions, setSourceOptions] = useState<SourceManga[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ascending, setAscending] = useState(false);
  const [chapterJump, setChapterJump] = useState("");
  const [jumpError, setJumpError] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<"read" | "unread" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [chapterBusy, setChapterBusy] = useState<number | null>(null);
  const [chapterPage, setChapterPage] = useState(1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    sourceService.getSeries(sourceKey)
      .then((next) => active && setItem(next))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "تعذر تحميل القصة."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sourceKey]);

  useEffect(() => {
    let active = true;
    if (requestedSourceKeys.length <= 1) {
      setSourceOptions([]);
      return;
    }
    sourceService
      .resolve(requestedSourceKeys)
      .then((resolved) => active && setSourceOptions(resolved))
      .catch(() => active && setSourceOptions([]));
    return () => { active = false; };
  }, [requestedSourceSignature]);

  const libraryEntry = useMemo(
    () => data?.library.find((entry) => entry.mangaId === sourceKey),
    [data?.library, sourceKey],
  );

  useEffect(() => {
    if (!item) return;
    void saveWorkSnapshot(item);
  }, [item]);

  const chapterCount = item?.chapters?.length ?? 0;
  const chapterPageCount = Math.max(1, Math.ceil(chapterCount / CHAPTERS_PER_PAGE));

  useEffect(() => {
    setChapterPage(1);
  }, [sourceKey]);

  useEffect(() => {
    setChapterPage((current) => Math.min(current, chapterPageCount));
  }, [chapterPageCount]);

  if (loading) return <><Back to={returnTo} /><p className="empty">جاري تحميل القصة والفصول من المصدر…</p></>;
  if (!item || error) return <><Back to={returnTo} /><h1>تعذر فتح القصة</h1><p className="error source-error">{error || "القصة غير موجودة في المصدر."}</p></>;

  const optionMap = new Map(sourceOptions.map((entry) => [entry.key, entry]));
  optionMap.set(item.key, item);
  const sourceChoices = requestedSourceKeys
    .map((entryKey) => optionMap.get(entryKey))
    .filter((entry): entry is SourceManga => Boolean(entry));
  const chapters = item.chapters ?? [];
  const orderedChapters = [...chapters].sort((a, b) => ascending ? a.number - b.number : b.number - a.number);
  const visibleChapters = orderedChapters.slice(
    (chapterPage - 1) * CHAPTERS_PER_PAGE,
    chapterPage * CHAPTERS_PER_PAGE,
  );
  const firstChapter = [...chapters].sort((a, b) => a.number - b.number)[0]?.number;
  const highestChapter = libraryEntry?.highestReachedChapter ?? null;
  const highestCompleted =
    highestChapter != null && Boolean(data?.completed.includes(`${sourceKey}:${highestChapter}`));
  const startChapter =
    highestChapter != null
      ? getContinueChapter(chapters, highestChapter, highestCompleted)
      : firstChapter;
  const startChapterEntry =
    startChapter != null
      ? chapters.find((entry) => Math.abs(Number(entry.number) - Number(startChapter)) < 0.000001)
      : undefined;
  const isFavorite = data?.favorites.includes(sourceKey);
  const displayTitle = sourceDisplayTitle(item);
  const coverItem = preferredSourceCover(sourceChoices.length ? sourceChoices : [item]) ?? item;

  const setChapterReadState = async (chapterNumber: number, read: boolean) => {
    if (chapterBusy != null) return;
    setChapterBusy(chapterNumber);
    try {
      if (read) {
        await saveProgress({ mangaId: sourceKey, chapter: chapterNumber, percent: 100, updatedAt: Date.now() });
      } else {
        await markChapterUnread(sourceKey, chapterNumber);
      }
    } finally {
      setChapterBusy(null);
    }
  };

  const applyBulkReadState = async (read: boolean) => {
    if (bulkBusy) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: read ? chapters.length : 1 });
    try {
      if (read) {
        const chapterNumbers = chapters.map((entry) => entry.number);
        const batchSize = 1000;
        let done = 0;
        for (let index = 0; index < chapterNumbers.length; index += batchSize) {
          const batch = chapterNumbers.slice(index, index + batchSize);
          const processed = await markChaptersRead(sourceKey, batch);
          done += processed;
          setBulkProgress({ done, total: chapterNumbers.length });
        }
      } else {
        // A merged work can exist under several source-specific IDs. "لم تتم
        // قراءتها" is a work-level action for the user, so clear every source
        // variant currently attached to this merged work, not only the tab
        // they happened to be viewing.
        const keysToClear = requestedSourceKeys.length
          ? requestedSourceKeys
          : [sourceKey];
        setBulkProgress({ done: 0, total: keysToClear.length });
        let done = 0;
        for (const keyToClear of keysToClear) {
          await markWorkUnread(keyToClear);
          done += 1;
          setBulkProgress({ done, total: keysToClear.length });
        }
      }
      setBulkConfirm(null);
    } finally {
      setBulkBusy(false);
    }
  };

  const jumpToChapter = () => {
    const raw = chapterJump.trim().replace(",", ".");
    const number = Number(raw);
    const chapter = chapters.find((entry) => Math.abs(entry.number - number) < 0.000001);
    if (!raw || !Number.isFinite(number) || !chapter) {
      setJumpError("رقم الفصل غير موجود");
      return;
    }
    setJumpError("");
    navigate(readerPath(item, chapter.number, requestedSourceKeys, chapter.url));
  };

  const goToChapterPage = (nextPage: number) => {
    const bounded = Math.max(1, Math.min(chapterPageCount, nextPage));
    setChapterPage(bounded);
    requestAnimationFrame(() => {
      document.querySelector(".chapter-heading")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  return (
    <>
      <Back to={returnTo} />
      <div className="details-hero">
        {coverItem.cover ? <SourceCoverImage item={coverItem} className="detail-cover" alt={`غلاف ${displayTitle}`} /> :
          <div className="detail-cover source-cover-placeholder source-detail-placeholder">{item.title.slice(0, 1)}</div>}
        <div>
          <p className="eyebrow">{sourceService.sourceLabel(item.source)} · {statusLabel(item.status)}</p>
          <h1 dir="auto">{displayTitle}</h1>
          {sourceChoices.length > 1 && (
            <div className="source-switcher" aria-label="اختيار مصدر القصة">
              <span className="source-switcher-label">اختر المصدر</span>
              <div className="source-switcher-options">
                {sourceChoices.map((option) => (
                  <Link
                    key={option.key}
                    className={`source-switch-option ${option.key === sourceKey ? "active" : ""}`}
                    aria-current={option.key === sourceKey ? "page" : undefined}
                    to={sourceDetailsPath(option.key, requestedSourceKeys)}
                  >
                    {sourceService.sourceLabel(option.source)}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="genres">{(item.genres ?? []).slice(0, 10).map((genre) => <span key={genre}>{genre}</span>)}</div>
          {item.description && <p className="description" dir="auto">{item.description}</p>}
          <div className="detail-actions">
            {startChapter != null && <Link className="primary" to={readerPath(item, startChapter, requestedSourceKeys, startChapterEntry?.url)}>{highestChapter != null ? "متابعة القراءة" : "ابدأ القراءة"} <Icon name="arrow" /></Link>}
            <ListManager mangaId={sourceKey} />
            <button className="secondary" aria-pressed={isFavorite} onClick={() => void favorite(sourceKey)}><Icon name={isFavorite ? "check" : "favorites"} />{isFavorite ? "في المفضلة" : "إضافة للمفضلة"}</button>
          </div>
        </div>
      </div>

      <div className="section-title chapter-heading">
        <h2>الفصول</h2>
        <span className="muted">
          {item.chapterListComplete === false &&
          item.declaredChapterCount != null &&
          item.declaredChapterCount > chapters.length
            ? `${chapters.length} من ${item.declaredChapterCount} فصل`
            : `${chapters.length} فصل`}
        </span>
      </div>

      {item.chapterListComplete === false &&
        item.declaredChapterCount != null &&
        item.declaredChapterCount > chapters.length && (
          <p className="chapter-list-warning" role="status">
            المصدر يعلن {item.declaredChapterCount} فصل، وتم التحقق من {chapters.length} فقط.
            Wany لن يعتبر القائمة كاملة حتى يجلب بقية صفحات المصدر.
          </p>
        )}

      {!!chapters.length && (
        <div className="chapter-tools">
          <button className="secondary chapter-sort" onClick={() => { setAscending((value) => !value); setChapterPage(1); }} aria-label="عكس ترتيب الفصول">
            <span className="sort-arrows">⇅</span>
            {ascending ? "من الأقدم للأحدث" : "من الأحدث للأقدم"}
          </button>
          <div className="chapter-jump">
            <input inputMode="decimal" value={chapterJump} onChange={(event) => { setChapterJump(event.target.value); setJumpError(""); }} onKeyDown={(event) => { if (event.key === "Enter") jumpToChapter(); }} placeholder="اكتب رقم الفصل" aria-label="اكتب رقم الفصل" />
            <button className="primary chapter-jump-submit" onClick={jumpToChapter} aria-label="بحث عن الفصل" title="بحث عن الفصل"><Icon name="search" /></button>
          </div>
          {jumpError && <small className="chapter-jump-error">{jumpError}</small>}
          <div className="chapter-read-tools">
            <button className={`secondary chapter-bulk-read ${bulkConfirm === "read" ? "is-pending" : ""}`} onClick={() => setBulkConfirm("read")}>تمت قراءة الكل</button>
            <button className={`secondary chapter-bulk-unread ${bulkConfirm === "unread" ? "is-pending" : ""}`} onClick={() => setBulkConfirm("unread")}>لم تتم قراءة الكل</button>
          </div>
          {bulkConfirm && (
            <div className="chapter-bulk-confirm" role="alert">
              <span>{bulkConfirm === "read" ? "تعليم جميع الفصول كمقروءة؟" : "إلغاء القراءة والتتبع لهذا العمل؟"}</span>
              <div className="chapter-bulk-confirm-actions">
                <button className="secondary" disabled={bulkBusy} onClick={() => setBulkConfirm(null)}>إلغاء</button>
                <button className="primary" disabled={bulkBusy} onClick={() => void applyBulkReadState(bulkConfirm === "read")}>
                  {bulkBusy && bulkConfirm === "read"
                    ? `${bulkProgress.total ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 100}% · ${bulkProgress.done}/${bulkProgress.total}`
                    : bulkBusy
                      ? "..."
                      : "تأكيد"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ChapterPagination
        page={chapterPage}
        pages={chapterPageCount}
        onPage={goToChapterPage}
      />

      <div className="chapter-list">
        {visibleChapters.map((chapter) => {
          const progressKey = `${sourceKey}:${chapter.number}`;
          const progress = data?.progress[progressKey];
          const done = data?.completed.includes(progressKey);
          return <div key={`${chapter.number}:${chapter.title}`} className={`chapter-row ${progress && !done ? "reading" : ""}`}>
            <Link className="chapter-row-link" to={readerPath(item, chapter.number, requestedSourceKeys, chapter.url)}>
              <span className="chapter-number">{chapter.number}</span>
              <div><h3 dir="auto">{chapter.title || `الفصل ${chapter.number}`}</h3><small>{done ? "مقروء" : progress ? `قيد القراءة · ${Math.round(progress.percent)}%` : chapter.publishedAt ? formatGregorianDate(chapter.publishedAt) : "غير مقروء"}</small></div>
              <Icon name="arrow" />
            </Link>
            <button
              className={`chapter-read-toggle ${done ? "is-read" : ""}`}
              disabled={chapterBusy === chapter.number}
              onClick={() => void setChapterReadState(chapter.number, !done)}
            >
              {chapterBusy === chapter.number ? "…" : done ? "مقروء ✓" : "غير مقروء"}
            </button>
          </div>;
        })}
      </div>

      <ChapterPagination
        page={chapterPage}
        pages={chapterPageCount}
        onPage={goToChapterPage}
      />

      {!chapters.length && <p className="empty">المصدر ما رجع فصول لهذه القصة.</p>}
    </>
  );
}
