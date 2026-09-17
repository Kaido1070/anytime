import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Back, Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

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
  const navigate = useNavigate();
  const sourceKey = decodeURIComponent(key);
  const { data, favorite } = useLibrary();
  const [item, setItem] = useState<SourceManga | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ascending, setAscending] = useState(false);
  const [chapterJump, setChapterJump] = useState("");
  const [jumpError, setJumpError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    sourceService.getSeries(sourceKey)
      .then((next) => active && setItem(next))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "تعذر تحميل العمل."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sourceKey]);

  const saved = useMemo(() => Object.values(data?.progress ?? {})
    .filter((progress) => progress.mangaId === sourceKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [data?.progress, sourceKey]);

  if (loading) return <><Back to="/discover" /><p className="empty">جاري تحميل العمل والفصول من المصدر…</p></>;
  if (!item || error) return <><Back to="/discover" /><h1>تعذر فتح العمل</h1><p className="error source-error">{error || "العمل غير موجود في المصدر."}</p></>;

  const chapters = item.chapters ?? [];
  const orderedChapters = [...chapters].sort((a, b) => ascending ? a.number - b.number : b.number - a.number);
  const firstChapter = [...chapters].sort((a, b) => a.number - b.number)[0]?.number;
  const startChapter = saved?.chapter ?? firstChapter;
  const isFavorite = data?.favorites.includes(sourceKey);

  const jumpToChapter = () => {
    const raw = chapterJump.trim().replace(",", ".");
    const number = Number(raw);
    const chapter = chapters.find((entry) => Math.abs(entry.number - number) < 0.000001);
    if (!raw || !Number.isFinite(number) || !chapter) {
      setJumpError("رقم الفصل غير موجود");
      return;
    }
    setJumpError("");
    navigate(`/read-source/${encodeURIComponent(sourceKey)}/${chapter.number}`);
  };

  return (
    <>
      <Back to="/discover" />
      <div className="details-hero">
        {item.cover ? <img className="detail-cover" src={sourceService.imageUrl(item.source, item.cover)} alt={`غلاف ${item.title}`} /> :
          <div className="detail-cover source-cover-placeholder source-detail-placeholder">{item.title.slice(0, 1)}</div>}
        <div>
          <p className="eyebrow">{sourceService.sourceLabel(item.source)} · {statusLabel(item.status)}</p>
          <h1 dir="auto">{item.title}</h1>
          <div className="genres">{(item.genres ?? []).slice(0, 10).map((genre) => <span key={genre}>{genre}</span>)}</div>
          {item.description && <p className="description" dir="auto">{item.description}</p>}
          <div className="detail-actions">
            {startChapter != null && <Link className="primary" to={`/read-source/${encodeURIComponent(sourceKey)}/${startChapter}`}>{saved ? "متابعة القراءة" : "ابدأ القراءة"} <Icon name="arrow" /></Link>}
            <button className="secondary" aria-pressed={isFavorite} onClick={() => void favorite(sourceKey)}><Icon name={isFavorite ? "check" : "favorites"} />{isFavorite ? "في المفضلة" : "إضافة للمفضلة"}</button>
          </div>
        </div>
      </div>

      <div className="section-title chapter-heading">
        <h2>الفصول</h2>
        <span className="muted">{chapters.length} فصل</span>
      </div>

      {!!chapters.length && (
        <div className="chapter-tools">
          <button className="secondary chapter-sort" onClick={() => setAscending((value) => !value)} aria-label="عكس ترتيب الفصول">
            <span className="sort-arrows">⇅</span>
            {ascending ? "من الأقدم للأحدث" : "من الأحدث للأقدم"}
          </button>
          <div className="chapter-jump">
            <input inputMode="decimal" value={chapterJump} onChange={(event) => { setChapterJump(event.target.value); setJumpError(""); }} onKeyDown={(event) => { if (event.key === "Enter") jumpToChapter(); }} placeholder="رقم الفصل" aria-label="رقم الفصل" />
            <button className="primary" onClick={jumpToChapter}>اذهب</button>
          </div>
          {jumpError && <small className="chapter-jump-error">{jumpError}</small>}
        </div>
      )}

      <div className="chapter-list">
        {orderedChapters.map((chapter) => {
          const progressKey = `${sourceKey}:${chapter.number}`;
          const progress = data?.progress[progressKey];
          const done = data?.completed.includes(progressKey);
          return <Link key={`${chapter.number}:${chapter.title}`} to={`/read-source/${encodeURIComponent(sourceKey)}/${chapter.number}`} className={progress && !done ? "reading" : ""}>
            <span className="chapter-number">{chapter.number}</span>
            <div><h3 dir="auto">{chapter.title || `الفصل ${chapter.number}`}</h3><small>{done ? "مقروء" : progress ? `قيد القراءة · ${Math.round(progress.percent)}%` : chapter.publishedAt ? new Date(chapter.publishedAt).toLocaleDateString("ar-SA") : "غير مقروء"}</small></div>
            {done ? <Icon name="check" /> : <Icon name="arrow" />}
          </Link>;
        })}
      </div>
      {!chapters.length && <p className="empty">المصدر ما رجع فصول لهذا العمل.</p>}
    </>
  );
}
