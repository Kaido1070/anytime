import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon, Progress } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { sourceService } from "../services/sources";
import type { SourceChapterPayload } from "../types";

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
  const { data, saveProgress } = useLibrary();
  const chapter = payload.number;
  const saved = data?.progress[`${sourceKey}:${chapter}`]?.percent ?? 0;
  const [percent, setPercent] = useState(saved);
  const saveRef = useRef(saveProgress);
  const restoredRef = useRef(false);
  saveRef.current = saveProgress;

  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let ready = false;
    let timer: ReturnType<typeof setTimeout>;
    let restoreTimer: ReturnType<typeof setTimeout>;
    let latest = saved;

    const persist = () => {
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
      persist();
    };

    restoreTimer = setTimeout(restore, 120);

    const scroll = () => {
      if (!ready) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      latest = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      setPercent(latest);
      clearTimeout(timer);
      timer = setTimeout(persist, 1000);
    };

    const hidden = () => {
      if (document.visibilityState === "hidden") persist();
    };

    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hidden);

    return () => {
      clearTimeout(timer);
      clearTimeout(restoreTimer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hidden);
      if (ready) persist();
      history.scrollRestoration = previousRestoration;
      restoredRef.current = false;
    };
  }, [sourceKey, chapter, payload.pages.length]);

  return (
    <main className="reader source-reader">
      <header className="reader-header">
        <Link to={`/source/${encodeURIComponent(sourceKey)}`} aria-label="العودة إلى صفحة العمل">
          <Icon name="back" />
        </Link>
        <div>
          <small dir="auto">{payload.item.title}</small>
          <h1>الفصل {chapter}</h1>
        </div>
        <span>{Math.round(percent)}%</span>
      </header>

      <div className="reader-panels source-pages">
        {payload.pages.map((page, index) => (
          <img
            key={`${index}:${page}`}
            src={sourceService.imageUrl(payload.item.source, page)}
            alt={`${payload.item.title} - الفصل ${chapter} - صفحة ${index + 1}`}
            loading={index < 2 ? "eager" : "lazy"}
            fetchPriority={index === 0 ? "high" : "auto"}
            onLoad={() => {
              if (!restoredRef.current && index < 2) {
                window.dispatchEvent(new Event("resize"));
              }
            }}
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

      <div className="reader-progress">
        <Progress value={percent} />
        <span>تقدم القراءة: {Math.round(percent)}%</span>
      </div>
    </main>
  );
}
