import type { SourceManga, SourceName } from "../types";

const SOURCE_SEGMENTS: Record<SourceName, string> = {
  mangatime: "mangatime",
  teamx: "teamx",
  "3asq": "3asq",
  starzmanga: "starzmanga",
  xsano: "xsano",
  mangalik: "mangalik",
  azora: "azora",
};

const SOURCE_PREFIXES: Record<string, string> = {
  mangatime: "mt",
  teamx: "tx",
  "3asq": "aq",
  starzmanga: "sz",
  xsano: "xs",
  mangalik: "ml",
  azora: "az",
};

export function readerPath(
  item: Pick<SourceManga, "key" | "source" | "slug">,
  chapter: number | string,
  sourceKeys: string[] = [],
  chapterUrl?: string,
) {
  const keys = [...new Set([item.key, ...sourceKeys])]
    .filter((key) => /^(mt|tx|aq|sz|xs|ml|az):[A-Za-z0-9_-]{1,110}$/.test(key));

  // Keep the canonical source key in the route whenever the stored identity
  // can differ from the public slug. This prevents safeSlugKey normalization,
  // hashed ids, punctuation or encoded slugs from rebuilding the wrong key.
  const usesCanonicalKeyRoute =
    item.source === "mangatime" ||
    item.source === "xsano" ||
    item.source === "mangalik" ||
    item.source === "starzmanga" ||
    item.source === "3asq";
  const path = usesCanonicalKeyRoute
    ? `/read-source/${encodeURIComponent(item.key)}/${encodeURIComponent(String(chapter))}`
    : `/read/${SOURCE_SEGMENTS[item.source]}/${encodeURIComponent(item.slug)}/${encodeURIComponent(String(chapter))}`;

  const search = new URLSearchParams();
  if (keys.length > 1) search.set("sources", keys.join(","));
  if (chapterUrl) search.set("chapterUrl", chapterUrl);

  return search.size ? `${path}?${search.toString()}` : path;
}

export function sourceKeyFromReaderPath(source?: string, work?: string) {
  if (!source || !work) return "";
  const prefix = SOURCE_PREFIXES[source.toLowerCase()];
  if (!prefix) return "";
  return `${prefix}:${decodeURIComponent(work)}`;
}
