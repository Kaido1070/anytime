import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SourceCard } from "../components/SourceCard";
import { Icon } from "../components/UI";
import { mergeSourceItems } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { SourceManga, SourceName } from "../types";

const SOURCES: { id: SourceName; label: string }[] = [
  { id: "mangatime", label: "MangaTime" },
  { id: "teamx", label: "Team-X" },
  { id: "3asq", label: "3asq" },
];

type SourceFilter = "all" | SourceName;
type GenreId =
  | "action"
  | "fantasy"
  | "adventure"
  | "drama"
  | "comedy"
  | "romance"
  | "supernatural"
  | "martial-arts"
  | "isekai"
  | "system"
  | "school"
  | "mystery";

type HasMoreBySource = Record<SourceName, boolean>;

const EMPTY_HAS_MORE: HasMoreBySource = {
  mangatime: false,
  teamx: false,
  "3asq": false,
};

const GENRES: { id: GenreId; label: string; aliases: string[] }[] = [
  { id: "action", label: "أكشن", aliases: ["أكشن", "اكشن", "action"] },
  { id: "fantasy", label: "فانتزي", aliases: ["فانتزي", "فانتازيا", "fantasy"] },
  { id: "adventure", label: "مغامرات", aliases: ["مغامرات", "مغامرة", "adventure"] },
  { id: "drama", label: "دراما", aliases: ["دراما", "drama"] },
  { id: "comedy", label: "كوميدي", aliases: ["كوميدي", "كوميديا", "comedy"] },
  { id: "romance", label: "رومانسي", aliases: ["رومانسي", "رومانسية", "romance"] },
  { id: "supernatural", label: "قوة خارقة", aliases: ["قوة خارقة", "خارق للطبيعة", "supernatural"] },
  { id: "martial-arts", label: "فنون قتالية", aliases: ["فنون قتالية", "martial arts", "murim", "موريم"] },
  { id: "isekai", label: "إيسيكاي", aliases: ["إيسيكاي", "ايسيكاي", "isekai"] },
  { id: "system", label: "نظام", aliases: ["نظام", "system"] },
  { id: "school", label: "مدرسي", aliases: ["مدرسي", "مدرسة", "school", "school life"] },
  { id: "mystery", label: "غموض", aliases: ["غموض", "mystery"] },
];

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchesGenres(item: SourceManga, selected: GenreId[]) {
  if (!selected.length) return true;
  const itemGenres = (item.genres ?? []).map((genre) => normalize(String(genre)));
  if (!itemGenres.length) return false;
  return selected.some((id) => {
    const genre = GENRES.find((entry) => entry.id === id);
    if (!genre) return false;
    return genre.aliases.some((alias) => {
      const needle = normalize(alias);
      return itemGenres.some((value) => value.includes(needle) || needle.includes(value));
    });
  });
}

async function hydrateGenres(items: SourceManga[], sourceFilter: SourceFilter, selectedGenres: GenreId[]) {
  if (!selectedGenres.length) return items;
  const candidates = items.filter((item) => sourceFilter === "all" || item.source === sourceFilter);
  const resolved = new Map<string, SourceManga>();

  for (let index = 0; index < candidates.length; index += 6) {
    const batch = candidates.slice(index, index + 6);
    const results = await Promise.allSettled(batch.map((item) => sourceService.getSeries(item.key)));
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") resolved.set(batch[resultIndex].key, result.value);
    });
  }

  return items.map((item) => resolved.get(item.key) ?? item);
}

function filterLabel(source: SourceFilter, genres: GenreId[]) {
  const sourceLabel = source === "all" ? "كل المصادر" : sourceService.sourceLabel(source);
  if (!genres.length) return sourceLabel;
  return `${sourceLabel} · ${genres.length} تصنيف`;
}

export function Discover() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [genreFilters, setGenreFilters] = useState<GenreId[]>([]);
  const [draftSource, setDraftSource] = useState<SourceFilter>("all");
  const [draftGenres, setDraftGenres] = useState<GenreId[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [items, setItems] = useState<SourceManga[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"latest" | "search">("latest");
  const [page, setPage] = useState(1);
  const [hasMoreBySource, setHasMoreBySource] = useState<HasMoreBySource>(EMPTY_HAS_MORE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleGroups = useMemo(() => {
    const filtered = items.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      return matchesGenres(item, genreFilters);
    });
    return mergeSourceItems(filtered);
  }, [items, sourceFilter, genreFilters]);

  const hasMore = sourceFilter === "all"
    ? Object.values(hasMoreBySource).some(Boolean)
    : hasMoreBySource[sourceFilter];

  const activeFilterCount = (sourceFilter === "all" ? 0 : 1) + genreFilters.length;

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
      const hydrated = await hydrateGenres(result.items, sourceFilter, genreFilters);
      setMode("search");
      setPage(1);
      setItems(hydrated);
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
      const hydrated = await hydrateGenres(result.items, sourceFilter, genreFilters);
      setMode("latest");
      setPage(1);
      setQuery("");
      setItems(hydrated);
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

      const hydratedIncoming = await hydrateGenres(incoming, sourceFilter, genreFilters);
      setItems((current) => {
        const map = new Map(current.map((item) => [item.key, item]));
        for (const item of hydratedIncoming) map.set(item.key, item);
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

  function openFilters() {
    setDraftSource(sourceFilter);
    setDraftGenres(genreFilters);
    setFiltersOpen(true);
  }

  function toggleDraftGenre(id: GenreId) {
    setDraftGenres((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  async function restoreDefaultView() {
    setFilterLoading(true);
    setError("");
    try {
      const result = await fetchPage("latest", 1);
      setSourceFilter("all");
      setGenreFilters([]);
      setDraftSource("all");
      setDraftGenres([]);
      setMode("latest");
      setPage(1);
      setQuery("");
      setItems(result.items);
      setHasMoreBySource(result.hasMore);
      setError(result.warning);
      setFiltersOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إعادة الصفحة للوضع الافتراضي.");
    } finally {
      setFilterLoading(false);
    }
  }

  async function applyFilters() {
    if (draftSource === "all" && draftGenres.length === 0) {
      await restoreDefaultView();
      return;
    }

    setFilterLoading(true);
    setError("");
    try {
      const hydrated = await hydrateGenres(items, draftSource, draftGenres);
      setItems(hydrated);
      setSourceFilter(draftSource);
      setGenreFilters(draftGenres);
      setFiltersOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تطبيق الفلاتر الآن.");
    } finally {
      setFilterLoading(false);
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
        <button className={`secondary filter-trigger ${activeFilterCount ? "active" : ""}`} type="button" onClick={openFilters}>
          <Icon name="filter" />
          <span>فلتر</span>
          {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
        {mode === "search" && (
          <button className="secondary" type="button" onClick={() => void reset()} disabled={loading}>
            الأحدث
          </button>
        )}
      </form>

      <div className="section-title">
        <h2>{mode === "search" ? `نتائج ${query}` : "أحدث الأعمال"}</h2>
        <span className="muted">{filterLabel(sourceFilter, genreFilters)}</span>
      </div>

      {error && <p className="error source-error">{error}</p>}
      {(loading || filterLoading) && !visibleGroups.length && <p className="empty">جاري جلب الأعمال من المصادر…</p>}

      <div className="cover-grid source-grid">
        {visibleGroups.map((group) => (
          <SourceCard key={group.id} item={group.primary} sources={group.items} />
        ))}
      </div>

      {!loading && !filterLoading && !visibleGroups.length && !error && (
        <p className="empty">ما لقينا أعمال تطابق الفلاتر المحددة.</p>
      )}

      {hasMore && (
        <button className="secondary source-more" disabled={loading || filterLoading} onClick={() => void more()}>
          {loading ? "جاري التحميل…" : "تحميل المزيد"}
        </button>
      )}

      {filtersOpen && (
        <div className="filter-backdrop" onMouseDown={() => !filterLoading && setFiltersOpen(false)}>
          <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="فلترة الأعمال" onMouseDown={(event) => event.stopPropagation()}>
            <div className="filter-sheet-header">
              <div>
                <p className="eyebrow">تخصيص النتائج</p>
                <h2>الفلاتر</h2>
              </div>
              <button className="filter-close" type="button" aria-label="إغلاق" disabled={filterLoading} onClick={() => setFiltersOpen(false)}>×</button>
            </div>

            <div className="filter-group">
              <h3>المصدر</h3>
              <div className="filter-choice-grid source-choice-grid">
                <button type="button" className={draftSource === "all" ? "selected" : ""} onClick={() => setDraftSource("all")}>كل المصادر</button>
                {SOURCES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={draftSource === entry.id ? "selected" : ""}
                    onClick={() => setDraftSource((current) => current === entry.id ? "all" : entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-group-title">
                <h3>التصنيفات</h3>
                <span>{draftGenres.length ? `${draftGenres.length} محدد` : "اختياري"}</span>
              </div>
              <div className="filter-choice-grid genre-choice-grid">
                {GENRES.map((genre) => (
                  <button key={genre.id} type="button" className={draftGenres.includes(genre.id) ? "selected" : ""} aria-pressed={draftGenres.includes(genre.id)} onClick={() => toggleDraftGenre(genre.id)}>{genre.label}</button>
                ))}
              </div>
            </div>

            <div className="filter-sheet-actions">
              <button className="secondary" type="button" disabled={filterLoading} onClick={() => void restoreDefaultView()}>
                {filterLoading ? "جاري الإعادة…" : "إعادة تعيين"}
              </button>
              <button className="primary" type="button" disabled={filterLoading} onClick={() => void applyFilters()}>{filterLoading ? "جاري التطبيق…" : "تطبيق الفلاتر"}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
