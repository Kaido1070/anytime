import { useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { findManga } from "../data/mock";
import { useLibrary } from "../hooks/useLibrary";
import { Icon, Progress } from "../components/UI";
export function Reader() {
  const { id = "", chapter = "" } = useParams();
  const item = findManga(id);
  const number = Number(chapter);
  if (!item || !item.chapters.includes(number))
    return (
      <main className="page">
        <Link to="/">الرئيسية →</Link>
        <h1>الفصل غير موجود</h1>
      </main>
    );
  return <ReaderChapter key={`${id}:${number}`} id={id} chapter={number} />;
}
function ReaderChapter({ id, chapter }: { id: string; chapter: number }) {
  const item = findManga(id)!;
  const { data, saveProgress } = useLibrary();
  const saved = data?.progress[`${id}:${chapter}`]?.percent ?? 0;
  const [percent, setPercent] = useState(saved);
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let ready = false;
    let timer: ReturnType<typeof setTimeout>;
    let latest = saved;
    const persist = () => {
      void saveRef.current({
        mangaId: id,
        chapter,
        percent: latest,
        updatedAt: Date.now(),
      });
    };
    const frame = requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, (max * saved) / 100);
      ready = true;
      persist();
    });
    const scroll = () => {
      if (!ready) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      latest =
        max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      setPercent(latest);
      clearTimeout(timer);
      timer = setTimeout(persist, 250);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hidden);
      if (ready) persist();
      history.scrollRestoration = previousRestoration;
    };
  }, [id, chapter]);
  const previous = item.chapters.includes(chapter - 1);
  const next = item.chapters.includes(chapter + 1);
  return (
    <main className="reader">
      <header className="reader-header">
        <Link to={`/manga/${id}`} aria-label="العودة إلى صفحة العمل">
          <Icon name="back" />
        </Link>
        <div>
          <small>{item.title}</small>
          <h1>الفصل {chapter}</h1>
        </div>
        <span>{Math.round(percent)}%</span>
      </header>
      <div className="reader-panels">
        {Array.from({ length: 6 }, (_, i) => (
          <img
            key={i}
            src={`/panels/panel-${i + 1}.svg`}
            width="800"
            height="1100"
            alt={`صفحة تجريبية ${i + 1}`}
            fetchPriority={i === 0 ? "high" : "auto"}
          />
        ))}
      </div>
      <footer className="reader-end">
        <p className="eyebrow">نهاية الفصل {chapter}</p>
        <h2>جاهز تكمل؟</h2>
        <div className="reader-links">
          {previous ? (
            <Link className="secondary" to={`/read/${id}/${chapter - 1}`}>
              الفصل السابق →
            </Link>
          ) : (
            <span>أول فصل تجريبي</span>
          )}
          {next ? (
            <Link className="primary" to={`/read/${id}/${chapter + 1}`}>
              ← الفصل التالي
            </Link>
          ) : (
            <Link className="primary" to={`/manga/${id}`}>
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
