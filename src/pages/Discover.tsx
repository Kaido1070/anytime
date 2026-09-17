import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SourceCard } from "../components/SourceCard";
import { sourceService } from "../services/sources";
import type { SourceManga, SourceName } from "../types";

const SOURCES: { id: SourceName; label: string }[] = [
  { id: "mangatime", label: "MangaTime" },
  { id: "teamx", label: "Team-X" },
];

type SourceFilter = "all" | SourceName;

type HasMoreBySource = Record<SourceName, boolean>;

const EMPTY_HAS_MORE: HasMoreBySource = {
  mangatime: false,
  teamx: false,
};

function filterLabel(source: SourceFilter) {
  if (source === "all") return "كل المصادر";
  return sourceService.sourceLabel(source);
}

export function Discover() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [items, setItems] = useState<SourceManga[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"latest" | "search">("latest");
  const [page, setPage] = useState(1);
  const [hasMoreBySource, setHasMoreBySource] = useState<HasMoreBySource>(EMPTY_HAS_MORE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleItems = useMemo(
    () => sourceFilter === "all" ? items : items.filter((item) => item.source === sourceFilter),
    [items, sourceFilter],
  );

  const hasMore = sourceFilter === "all"
    ? Object.values(hasMoreBySource).some(Boolean)
    : hasMoreBySource[sourceFilter];

  async function fetchPage(nextMode: "latest" | "search", nextPage: number, term = "") {
    const results = await Promise.allSettled(
      SOURCES.map(async ({ id, label }) => {
        const result = nextMode === "search"
          ? await sourceService.search(id, term, nextPage)
          : await sourceService.latest(id, nextPage);
        return { id, label, result };
      }),
    );

    const nextItems: SourceManga[] = [];
    const nextHasMore: HasMoreBySource = { ...EMPTY_HAS_MORE };
    const failed: string[] = [];

    results.forEach((result, index) => {
      const source = SOURCES[index];
      if (result.status === "fulfilled") {
        nextItems.push(...result.value.result.items);
        nextHasMore[result.value.id] = result.value.result.hasMore;
      } else {
        failed.push(source.label);
      }
    });

    if (failed.length === SOURCES.length) {
      throw new Error(nextMode === "search" ? "تعذر البحث في المصادر الآن." : "تعذر تحميل المصادر الآن.");
    }

    return {
      items: nextItems,
      hasMore: nextHasMore,
      warning: failed.length ? `تعذر الوصول إلى ${failed.join(" و ")} مؤقتا وتم عرض بقية المصادر.` : "",
    };
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchPage("latest", 1)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setHasMoreBySource(result.hasMore);
        setError(result.warning);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل المصادر.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setLoading(true);
    setError("");
    try {
      const result = await fetchPage("search", 1, term);
      setMode("search");
      setPage(1);
      setItems(result.items);
      setHasMoreBySource(result.hasMore);
      setError(result.warning);
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
      const result = await fetchPage("latest", 1);
      setMode("latest");
      setPage(1);
      setQuery("");
      setItems(result.items);
      setHasMoreBySource(result.hasMore);
      setError(result.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المصادر.");
    } finally {
      setLoading(false);
    }
  }

  async function more() {
    const nextPage = page + 1;
    setLoading(true);
    setError("");
    try {
      const activeSources = SOURCES.filter(({ id }) => hasMoreBySource[id]);
      const results = await Promise.allSettled(
        activeSources.map(async ({ id, label }) => {
          const result = mode === "search"
            ? await sourceService.search(id, query.trim(), nextPage)
            : await sourceService.latest(id, nextPage);
          return { id, label, result };
        }),
      );

      const nextHasMore = { ...hasMoreBySource };
      const incoming: SourceManga[] = [];
      const failed: string[] = [];

      results.forEach((result, index) => {
        const source = activeSources[index];
        if (result.status === "fulfilled") {
          incoming.push(...result.value.result.items);
          nextHasMore[result.value.id] = result.value.result.hasMore;
        } else {
          failed.push(source.label);
        }
      });

      setItems((current) => {
        const map = new Map(current.map((item) => [item.key, item]));
        for (const item of incoming) map.set(item.key, item);
        return [...map.values()];
      });
      setHasMoreBySource(nextHasMore);
      setPage(nextPage);
      if (failed.length) setError(`تعذر تحميل المزيد من ${failed.join(" و ")} مؤقتا.`);
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
      <p className="muted page-intro">ابحث في كل المصادر واقرأ الفصول داخل Anytime.</p>

      <form className="source-search" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في كل المصادر"
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

      <div className="source-filter-row" aria-label="فلتر المصدر">
        <span className="source-filter-label">المصدر</span>
        <button
          type="button"
          className={sourceFilter === "all" ? "active" : ""}
          aria-pressed={sourceFilter === "all"}
          onClick={() => setSourceFilter("all")}
        >
          الكل
        </button>
        {SOURCES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={sourceFilter === entry.id ? "active" : ""}
            aria-pressed={sourceFilter === entry.id}
            onClick={() => setSourceFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="section-title">
        <h2>{mode === "search" ? `نتائج ${query}` : "أحدث الأعمال"}</h2>
        <span className="muted">{filterLabel(sourceFilter)}</span>
      </div>

      {error && <p className="error source-error">{error}</p>}
      {loading && !items.length && <p className="empty">جاري جلب الأعمال من المصادر…</p>}

      <div className="cover-grid source-grid">
        {visibleItems.map((item) => (
          <SourceCard key={item.key} item={item} />
        ))}
      </div>

      {!loading && !visibleItems.length && !error && (
        <p className="empty">ما لقينا نتائج بهذا الاسم في الفلتر المحدد.</p>
      )}

      {hasMore && (
        <button className="secondary source-more" disabled={loading} onClick={() => void more()}>
          {loading ? "جاري التحميل…" : "تحميل المزيد"}
        </button>
      )}
    </>
  );
}
