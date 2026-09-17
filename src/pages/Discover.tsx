import { useEffect, useState, type FormEvent } from "react";
import { SourceCard } from "../components/SourceCard";
import { sourceService } from "../services/sources";
import type { SourceManga, SourceName } from "../types";

const SOURCES: { id: SourceName; label: string }[] = [
  { id: "mangatime", label: "MangaTime" },
  { id: "teamx", label: "Team-X" },
];

export function Discover() {
  const [source, setSource] = useState<SourceName>("mangatime");
  const [items, setItems] = useState<SourceManga[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"latest" | "search">("latest");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    setMode("latest");
    setQuery("");
    setPage(1);
    sourceService
      .latest(source, 1)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setHasMore(result.hasMore);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل المصدر.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [source]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setLoading(true);
    setError("");
    try {
      const result = await sourceService.search(source, term, 1);
      setMode("search");
      setPage(1);
      setItems(result.items);
      setHasMore(result.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر البحث الآن.");
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    setLoading(true);
    setError("");
    try {
      const result = await sourceService.latest(source, 1);
      setMode("latest");
      setPage(1);
      setQuery("");
      setItems(result.items);
      setHasMore(result.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المصدر.");
    } finally {
      setLoading(false);
    }
  }

  async function more() {
    const nextPage = page + 1;
    setLoading(true);
    setError("");
    try {
      const result = mode === "search"
        ? await sourceService.search(source, query.trim(), nextPage)
        : await sourceService.latest(source, nextPage);
      setItems((current) => {
        const map = new Map(current.map((item) => [item.key, item]));
        for (const item of result.items) map.set(item.key, item);
        return [...map.values()];
      });
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المزيد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p className="eyebrow">مصادر حقيقية</p>
      <h1>
        استكشف<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">ابحث واقرأ الفصول داخل Anytime بدون فتح صفحة المصدر.</p>

      <div className="source-tabs" role="tablist" aria-label="مصدر القراءة">
        {SOURCES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={source === entry.id ? "active" : ""}
            onClick={() => setSource(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form className="source-search" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`ابحث في ${sourceService.sourceLabel(source)}`}
          dir="auto"
          enterKeyHint="search"
        />
        <button className="primary" disabled={loading || !query.trim()}>
          بحث
        </button>
        {mode === "search" && (
          <button className="secondary" type="button" onClick={() => void reset()} disabled={loading}>
            الأحدث
          </button>
        )}
      </form>

      <div className="section-title">
        <h2>{mode === "search" ? `نتائج ${query}` : "أحدث الأعمال"}</h2>
        <span className="muted">{sourceService.sourceLabel(source)}</span>
      </div>

      {error && <p className="error source-error">{error}</p>}
      {loading && !items.length && <p className="empty">جاري جلب الأعمال من المصدر…</p>}

      <div className="cover-grid source-grid">
        {items.map((item) => (
          <SourceCard key={item.key} item={item} />
        ))}
      </div>

      {!loading && !items.length && !error && (
        <p className="empty">ما لقينا نتائج بهذا الاسم.</p>
      )}

      {hasMore && (
        <button className="secondary source-more" disabled={loading} onClick={() => void more()}>
          {loading ? "جاري التحميل…" : "تحميل المزيد"}
        </button>
      )}
    </>
  );
}
