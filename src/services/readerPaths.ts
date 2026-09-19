import type { SourceManga, SourceName } from "../types";

const SOURCE_SEGMENTS: Record<SourceName, string> = {
  mangatime: "mangatime",
  teamx: "teamx",
  "3asq": "3asq",
  starzmanga: "starzmanga",
  xsano: "xsano",
  mangalik: "mangalik",
};

const SOURCE_PREFIXES: Record<string, string> = {
  mangatime: "mt",
  teamx: "tx",
  "3asq": "aq",
  starzmanga: "sz",
  xsano: "xs",
  mangalik: "ml",
};

export function readerPath(item: Pick<SourceManga, "source" | "slug">, chapter: number | string) {
  return `/read/${SOURCE_SEGMENTS[item.source]}/${encodeURIComponent(item.slug)}/${encodeURIComponent(String(chapter))}`;
}

export function sourceKeyFromReaderPath(source?: string, work?: string) {
  if (!source || !work) return "";
  const prefix = SOURCE_PREFIXES[source.toLowerCase()];
  if (!prefix) return "";
  return `${prefix}:${decodeURIComponent(work)}`;
}
