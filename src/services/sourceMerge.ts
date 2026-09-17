import type { SourceManga, SourceName } from "../types";
import { sourceEnglishTitle } from "./sourceTitles";

export interface SourceGroup {
  id: string;
  primary: SourceManga;
  items: SourceManga[];
}

const SOURCE_PRIORITY: Partial<Record<SourceName, number>> = {
  mangatime: 0,
  teamx: 1,
  "3asq": 2,
  starzmanga: 3,
  xsano: 4,
};

const COVER_PRIORITY: Partial<Record<SourceName, number>> = {
  teamx: 0,
  "3asq": 1,
  starzmanga: 2,
  xsano: 3,
  mangatime: 4,
};

function normalizeIdentity(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/&/g, " and ")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulIdentity(value: string) {
  if (value.length < 6) return false;
  const words = value.split(" ").filter(Boolean);
  return words.length >= 2 || value.length >= 10;
}

function addIdentity(set: Set<string>, raw: string) {
  const normalized = normalizeIdentity(raw);
  if (!isUsefulIdentity(normalized)) return;
  set.add(normalized);

  // Articles are frequently dropped between Arabic scanlation sources.
  if (/^[a-z0-9 ]+$/.test(normalized)) {
    const withoutArticle = normalized.replace(/^(?:the|a|an)\s+/, "");
    if (withoutArticle !== normalized && isUsefulIdentity(withoutArticle)) {
      set.add(withoutArticle);
    }
  }
}

export function sourceIdentityCandidates(item: SourceManga) {
  const identities = new Set<string>();
  const english = sourceEnglishTitle(item);
  if (english) addIdentity(identities, english);

  const plainTitle = item.title.replace(/\s*[\[(][^\])]+[\])]\s*$/, "").trim();
  addIdentity(identities, item.title);
  if (plainTitle && plainTitle !== item.title) addIdentity(identities, plainTitle);

  addIdentity(identities, item.slug.replace(/[-_]+/g, " "));
  return identities;
}

function intersects(a: Set<string>, b: Set<string>) {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function pickPrimary(items: SourceManga[]) {
  return [...items].sort((a, b) => {
    const sourceOrder = (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99);
    if (sourceOrder) return sourceOrder;
    if (Boolean(a.cover) !== Boolean(b.cover)) return a.cover ? -1 : 1;
    return a.key.localeCompare(b.key);
  })[0];
}

export function preferredSourceCover(items: SourceManga[]) {
  const candidates = items.filter((item) => Boolean(item.cover));
  if (!candidates.length) return items[0];
  return [...candidates].sort((a, b) => {
    const sourceOrder = (COVER_PRIORITY[a.source] ?? 99) - (COVER_PRIORITY[b.source] ?? 99);
    if (sourceOrder) return sourceOrder;
    return a.key.localeCompare(b.key);
  })[0];
}

export function mergeSourceItems(items: SourceManga[]): SourceGroup[] {
  const uniqueItems = [...new Map(items.map((item) => [item.key, item])).values()];
  const groups: Array<SourceGroup & { identities: Set<string> }> = [];

  for (const item of uniqueItems) {
    const identities = sourceIdentityCandidates(item);
    const match = groups.find((group) => {
      if (group.items.some((existing) => existing.source === item.source)) return false;
      return intersects(group.identities, identities);
    });

    if (!match) {
      groups.push({
        id: item.key,
        primary: item,
        items: [item],
        identities,
      });
      continue;
    }

    match.items.push(item);
    for (const identity of identities) match.identities.add(identity);
    match.primary = pickPrimary(match.items);
    match.id = match.items.map((entry) => entry.key).sort().join("|");
  }

  return groups.map(({ identities: _identities, ...group }) => group);
}

export function sourceGroupKeys(values: Array<SourceManga | string>) {
  return [...new Set(values.map((value) => typeof value === "string" ? value : value.key).filter(isSourceKey))];
}

export function parseSourceGroupKeys(raw: string | null | undefined, currentKey: string) {
  const values = String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12);
  return sourceGroupKeys([currentKey, ...values]);
}

export function sourceDetailsPath(key: string, values: Array<SourceManga | string> = []) {
  const keys = sourceGroupKeys([key, ...values]);
  const base = `/source/${encodeURIComponent(key)}`;
  if (keys.length <= 1) return base;
  const search = new URLSearchParams({ sources: keys.join(",") });
  return `${base}?${search.toString()}`;
}

function isSourceKey(value: string) {
  return /^(?:mt|tx|aq|sz|xs):[A-Za-z0-9_-]{1,110}$/.test(value);
}
