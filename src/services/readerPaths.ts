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
) {
  const keys = [...new Set([item.key, ...sourceKeys])]
    .filter((key) => /^(mt|tx|aq|sz|xs|ml|az):[A-Za-z0-9_-]{1,110}$/.test(key));

  // MangaTime source keys are ID-backed (mt:<sourceId>) and are not derived
  // from the public series slug. Keep the canonical source key in the route so
  // direct chapter opens, refreshes and reader navigation never rebuild the
  // wrong key as mt:<slug>.
  const path = item.source === "mangatime"
    ? `/read-source/${encodeURIComponent(item.key)}/${encodeURIComponent(String(chapter))}`
    : `/read/${SOURCE_SEGMENTS[item.source]}/${encodeURIComponent(item.slug)}/${encodeURIComponent(String(chapter))}`;

  if (keys.length <= 1) return path;

  const search = new URLSearchParams({ sources: keys.join(",") });
  return `${path}?${search.toString()}`;
}

export function sourceKeyFromReaderPath(source?: string, work?: string) {
  if (!source || !work) return "";
  const prefix = SOURCE_PREFIXES[source.toLowerCase()];
  if (!prefix) return "";
  return `${prefix}:${decodeURIComponent(work)}`;
}
