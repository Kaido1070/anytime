import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SourceCard } from "../components/SourceCard";
import { Icon } from "../components/UI";
import { mergeSourceItems, rankSourceGroupsByQuery } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { SourceManga, SourceName } from "../types";

const SOURCES: { id: SourceName; label: string }[] = [
  { id: "mangatime", label: "MangaTime" },
  { id: "teamx", label: "Team-X" },
  { id: "3asq", label: "3asq" },
  { id: "starzmanga", label: "StarzManga" },
  { id: "xsano", label: "XSano Manga" },
  { id: "mangalik", label: "MangaLik" },
];

type SourceFilter = "all" | SourceName;
type WorkTypeFilter = "all" | "manga" | "manhwa" | "manhua" | "webtoon" | "novel" | "comic";
type StatusFilter = "all" | "ongoing" | "completed" | "hiatus" | "cancelled";
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
  | "mystery"
  | "novel"
  | "sci-fi"
  | "horror"
  | "thriller"
  | "psychological"
  | "historical"
  | "military"
  | "sports"
  | "slice-of-life"
  | "tragedy"
  | "reincarnation"
  | "regression"
  | "cultivation"
  | "magic"
  | "demons"
  | "monsters"
  | "survival"
  | "game"
  | "dungeon"
  | "hunter"
  | "villainess"
  | "royalty"
  | "medical"
  | "cooking"
  | "business"
  | "crime"
  | "shounen"
  | "shoujo"
  | "seinen"
  | "josei";

type HasMoreBySource = Record<SourceName, boolean>;

const EMPTY_HAS_MORE: HasMoreBySource = {
  mangatime: false,
  teamx: false,
  "3asq": false,
  starzmanga: false,
  xsano: false,
  mangalik: false,
};

const WORK_TYPES: { id: Exclude<WorkTypeFilter, "all">; label: string }[] = [
  { id: "manga", label: "مانجا" },
  { id: "manhwa", label: "مانهوا" },
  { id: "manhua", label: "مانها" },
  { id: "webtoon", label: "ويب تون" },
  { id: "novel", label: "روايات" },
  { id: "comic", label: "كوميك" },
];

const STATUSES: { id: Exclude<StatusFilter, "all">; label: string }[] = [
  { id: "ongoing", label: "مستمر" },
  { id: "completed", label: "مكتمل" },
  { id: "hiatus", label: "متوقف" },
  { id: "cancelled", label: "متروك" },
];

const GENRES: { id: GenreId; label: string; aliases: string[] }[] = [
  { id: "action", label: "أكشن", aliases: ["أكشن", "اكشن", "action"] },
  { id: "fantasy", label: "فانتزي", aliases: ["فانتزي", "فانتازيا", "fantasy"] },
  { id: "adventure", label: "مغامرات", aliases: ["مغامرات", "مغامرة", "adventure"] },
  { id: "drama", label: "دراما", aliases: ["دراما", "drama"] },
  { id: "comedy", label: "كوميدي", aliases: ["كوميدي", "كوميديا", "comedy"] },
  { id: "romance", label: "رومانسي", aliases: ["رومانسي", "رومانسية", "romance"] },
  { id: "supernatural", label: "خارق للطبيعة", aliases: ["قوة خارقة", "خارق للطبيعة", "supernatural"] },
  { id: "martial-arts", label: "فنون قتالية", aliases: ["فنون قتالية", "martial arts", "murim", "موريم"] },
  { id: "isekai", label: "إيسيكاي", aliases: ["إيسيكاي", "ايسيكاي", "isekai"] },
  { id: "system", label: "نظام", aliases: ["نظام", "system"] },
  { id: "school", label: "مدرسي", aliases: ["مدرسي", "مدرسة", "school", "school life"] },
  { id: "mystery", label: "غموض", aliases: ["غموض", "mystery"] },
  { id: "novel", label: "روايات", aliases: ["روايات", "رواية", "رواية ويب", "novel", "web novel", "light novel"] },
  { id: "sci-fi", label: "خيال علمي", aliases: ["خيال علمي", "science fiction", "sci fi", "sci-fi"] },
  { id: "horror", label: "رعب", aliases: ["رعب", "horror"] },
  { id: "thriller", label: "إثارة", aliases: ["إثارة", "اثارة", "thriller", "suspense"] },
  { id: "psychological", label: "نفسي", aliases: ["نفسي", "psychological"] },
  { id: "historical", label: "تاريخي", aliases: ["تاريخي", "historical", "history"] },
  { id: "military", label: "عسكري", aliases: ["عسكري", "military", "war"] },
  { id: "sports", label: "رياضة", aliases: ["رياضة", "رياضي", "sports"] },
  { id: "slice-of-life", label: "شريحة من الحياة", aliases: ["شريحة من الحياة", "slice of life"] },
  { id: "tragedy", label: "مأساة", aliases: ["مأساة", "ماساة", "tragedy"] },
  { id: "reincarnation", label: "تناسخ", aliases: ["تناسخ", "reincarnation", "reincarnated"] },
  { id: "regression", label: "عودة بالزمن", aliases: ["عودة بالزمن", "رجوع", "regression", "regressor", "returner"] },
  { id: "cultivation", label: "زراعة", aliases: ["زراعة", "cultivation", "xianxia", "wuxia"] },
  { id: "magic", label: "سحر", aliases: ["سحر", "magic", "magical"] },
  { id: "demons", label: "شياطين", aliases: ["شياطين", "شيطان", "demon", "demons"] },
  { id: "monsters", label: "وحوش", aliases: ["وحوش", "وحش", "monster", "monsters"] },
  { id: "survival", label: "بقاء", aliases: ["بقاء", "survival"] },
  { id: "game", label: "ألعاب", aliases: ["ألعاب", "العاب", "game", "gaming", "virtual reality"] },
  { id: "dungeon", label: "زنزانات", aliases: ["زنزانة", "زنزانات", "dungeon", "dungeons"] },
  { id: "hunter", label: "صيادون", aliases: ["صياد", "صيادون", "hunter", "hunters"] },
  { id: "villainess", label: "شريرة", aliases: ["شريرة", "villainess", "villain"] },
  { id: "royalty", label: "ملكي", aliases: ["ملكي", "ملوك", "أميرة", "اميرة", "royalty", "royal", "nobility"] },
  { id: "medical", label: "طبي", aliases: ["طبي", "طب", "medical", "doctor"] },
  { id: "cooking", label: "طبخ", aliases: ["طبخ", "طهي", "cooking", "food"] },
  { id: "business", label: "أعمال", aliases: ["أعمال", "اعمال", "business", "economics"] },
  { id: "crime", label: "جريمة", aliases: ["جريمة", "جرائم", "crime", "mafia"] },
  { id: "shounen", label: "شونين", aliases: ["شونين", "shounen", "shonen"] },
  { id: "shoujo", label: "شوجو", aliases: ["شوجو", "shoujo", "shojo"] },
  { id: "seinen", label: "سينين", aliases: ["سينين", "seinen"] },
  { id: "josei", label: "جوسي", aliases: ["جوسي", "josei"] },
];

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
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

function normalizedWorkType(item: SourceManga): Exclude<WorkTypeFilter, "all"> | "" {
  const raw = normalize([item.type, ...(item.genres ?? [])].filter(Boolean).join(" "));
  if (/رواي|web novel|light novel|\bnovel\b/.test(raw)) return "novel";
  if (/مانهوا|\bmanhwa\b/.test(raw)) return "manhwa";
  if (/مانها|مانهوا صيني|\bmanhua\b/.test(raw)) return "manhua";
  if (/ويب تون|مانجا ويب|\bwebtoon\b/.test(raw)) return "webtoon";
  if (/كوميك|\bcomic\b/.test(raw)) return "comic";
  if (/مانجا|\bmanga\b/.test(raw)) return "manga";
  return "";
}

function normalizedStatus(item: SourceManga): Exclude<StatusFilter, "all"> | "" {
  const raw = normalize(item.status ?? "");
  if (["ongoing", "مستمر", "مستمره"].includes(raw)) return "ongoing";
  if (["completed", "مكتمل", "مكتمله"].includes(raw)) return "completed";
  if (["hiatus", "متوقف", "موسم منتهي"].includes(raw)) return "hiatus";
  if (["cancelled", "canceled", "dropped", "متروك", "ملغي"].includes(raw)) return "cancelled";
  return "";
}

function matchesMetadata(
  item: SourceManga,
  genres: GenreId[],
  type: WorkTypeFilter,
  status: StatusFilter,
) {
  if (!matchesGenres(item, genres)) return false;
  if (type !== "all" && normalizedWorkType(item) !== type) return false;
  if (status !== "all" && normalizedStatus(item) !== status) return false;
  return true;
}

function needsMetadata(genres: GenreId[], type: WorkTypeFilter, status: StatusFilter) {
  return genres.length > 0 || type !== "all" || status !== "all";
}

async function hydrateMetadata(
  items: SourceManga[],
  sourceFilter: SourceFilter,
  selectedGenres: GenreId[],
  typeFilter: WorkTypeFilter,
  statusFilter: StatusFilter,
) {
  if (!needsMetadata(selectedGenres, typeFilter, statusFilter)) return items;
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

function filterLabel(
  source: SourceFilter,
  genres: GenreId[],
  type: WorkTypeFilter,
  status: StatusFilter,
) {
  const sourceLabel = source === "all" ? "كل المصادر" : sourceService.sourceLabel(source);
  const extraCount = genres.length + (type === "all" ? 0 : 1) + (status === "all" ? 0 : 1);
  if (!extraCount) return sourceLabel;
  return `${sourceLabel} · ${extraCount} فلتر`;
}

export function Discover() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [genreFilters, setGenreFilters] = useState<GenreId[]>([]);
  const [typeFilter, setTypeFilter] = useState<WorkTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [draftSource, setDraftSource] = useState<SourceFilter>("all");
  const [draftGenres, setDraftGenres] = useState<GenreId[]>([]);
  const [draftType, setDraftType] = useState<WorkTypeFilter>("all");
  const [draftStatus, setDraftStatus] = useState<StatusFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [items, setItems] = useState<SourceManga[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"latest" | "search">("latest");
  const [page, setPage] = useState(1);
  const [hasMoreBySource, setHasMoreBySource] = useState<HasMoreBySource>(EMPTY_HAS_MORE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const visibleGroups = useMemo(() => {
    const filtered = items.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      return matchesMetadata(item, genreFilters, typeFilter, statusFilter);
    });
    const merged = mergeSourceItems(filtered);
    return mode === "search" ? rankSourceGroupsByQuery(merged, query) : merged;
  }, [items, sourceFilter, genreFilters, typeFilter, statusFilter, mode, query]);

  const hasMore = sourceFilter === "all"
    ? Object.values(hasMoreBySource).some(Boolean)
    : hasMoreBySource[sourceFilter];

  const activeFilterCount =
    (sourceFilter === "all" ? 0 : 1) +
    genreFilters.length +
    (typeFilter === "all" ? 0 : 1) +
    (statusFilter === "all" ? 0 : 1);

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

    searchInputRef.current?.blur();
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setLoading(true);
    setError("");
    try {
      const result = await fetchPage("search", 1, term);
      const hydrated = await hydrateMetadata(
        result.items,
        sourceFilter,
        genreFilters,
        typeFilter,
        statusFilter,
      );
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
      const hydrated = await hydrateMetadata(
        result.items,
        sourceFilter,
        genreFilters,
        typeFilter,
        statusFilter,
      );
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

      const hydratedIncoming = await hydrateMetadata(
        incoming,
        sourceFilter,
        genreFilters,
        typeFilter,
        statusFilter,
      );
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
    setDraftType(typeFilter);
    setDraftStatus(statusFilter);
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
      setTypeFilter("all");
      setStatusFilter("all");
      setDraftSource("all");
      setDraftGenres([]);
      setDraftType("all");
      setDraftStatus("all");
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
    if (
      draftSource === "all" &&
      draftGenres.length === 0 &&
      draftType === "all" &&
      draftStatus === "all"
    ) {
      await restoreDefaultView();
      return;
    }

    setFilterLoading(true);
    setError("");
    try {
      const hydrated = await hydrateMetadata(
        items,
        draftSource,
        draftGenres,
        draftType,
        draftStatus,
      );
      setItems(hydrated);
      setSourceFilter(draftSource);
      setGenreFilters(draftGenres);
      setTypeFilter(draftType);
      setStatusFilter(draftStatus);
      setFiltersOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تطبيق الفلاتر الآن.");
    } finally {
      setFilterLoading(false);
    }
  }

  return (
    <>
      <p className="eyebrow">كل المصادر، مكان واحد</p>
      <h1>
        استكشف<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">ابحث عن قصتك التالية واقرأ فصولها مباشرة داخل Wany.</p>

      <form className="source-search" onSubmit={submit}>
        <input
          ref={searchInputRef}
          type="search"
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
        <h2>{mode === "search" ? `نتائج ${query}` : "أحدث القصص"}</h2>
        <span className="muted">{filterLabel(sourceFilter, genreFilters, typeFilter, statusFilter)}</span>
      </div>

      {error && <p className="error source-error">{error}</p>}
      {(loading || filterLoading) && !visibleGroups.length && <p className="empty">جاري جلب القصص من المصادر…</p>}

      <div className="cover-grid source-grid">
        {visibleGroups.map((group) => (
          <SourceCard key={group.id} item={group.primary} sources={group.items} />
        ))}
      </div>

      {!loading && !filterLoading && !visibleGroups.length && !error && (
        <p className="empty">ما لقينا قصص تطابق الفلاتر المحددة.</p>
      )}

      {hasMore && (
        <button className="secondary source-more" disabled={loading || filterLoading} onClick={() => void more()}>
          {loading ? "جاري التحميل…" : "تحميل المزيد"}
        </button>
      )}

      {filtersOpen && (
        <div className="filter-backdrop" onMouseDown={() => !filterLoading && setFiltersOpen(false)}>
          <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="فلترة القصص" onMouseDown={(event) => event.stopPropagation()}>
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
              <h3>نوع القصة</h3>
              <div className="filter-choice-grid source-choice-grid">
                <button type="button" className={draftType === "all" ? "selected" : ""} onClick={() => setDraftType("all")}>كل الأنواع</button>
                {WORK_TYPES.map((entry) => (
                  <button key={entry.id} type="button" className={draftType === entry.id ? "selected" : ""} onClick={() => setDraftType(entry.id)}>
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <h3>الحالة</h3>
              <div className="filter-choice-grid source-choice-grid">
                <button type="button" className={draftStatus === "all" ? "selected" : ""} onClick={() => setDraftStatus("all")}>كل الحالات</button>
                {STATUSES.map((entry) => (
                  <button key={entry.id} type="button" className={draftStatus === entry.id ? "selected" : ""} onClick={() => setDraftStatus(entry.id)}>
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
