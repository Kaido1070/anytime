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
  mangalik: 5,
  mangadar: 6,
};

const COVER_PRIORITY: Partial<Record<SourceName, number>> = {
  teamx: 0,
  "3asq": 1,
  starzmanga: 2,
  xsano: 3,
  mangalik: 4,
  mangadar: 5,
  mangatime: 5,
};

const LATIN_ARTICLES = new Set(["the", "a", "an"]);
const GENERIC_TITLE_SUFFIXES = new Set([
  "manga",
  "manhwa",
  "manhua",
  "webtoon",
  "comic",
]);

export function normalizeSourceIdentity(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/&/g, " and ")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identityTokens(value: string) {
  const tokens = normalizeSourceIdentity(value).split(" ").filter(Boolean);
  const latinOnly = tokens.every((token) => /^[a-z0-9]+$/.test(token));
  if (!latinOnly) return tokens;

  const cleaned = [...tokens];
  while (cleaned.length > 1 && LATIN_ARTICLES.has(cleaned[0])) cleaned.shift();
  return cleaned.filter((token) => token !== "s");
}

function isUsefulIdentity(value: string) {
  if (value.length < 5) return false;
  const words = value.split(" ").filter(Boolean);
  return words.length >= 2 || value.length >= 7;
}

function addIdentity(set: Set<string>, raw: string) {
  const normalized = normalizeSourceIdentity(raw);
  if (!isUsefulIdentity(normalized)) return;
  set.add(normalized);

  const tokens = identityTokens(normalized);
  if (tokens.length) {
    const withoutArticles = tokens.join(" ");
    if (withoutArticles !== normalized && isUsefulIdentity(withoutArticles)) {
      set.add(withoutArticles);
    }

    if (tokens.length > 1 && GENERIC_TITLE_SUFFIXES.has(tokens[tokens.length - 1])) {
      const withoutSuffix = tokens.slice(0, -1).join(" ");
      if (isUsefulIdentity(withoutSuffix)) set.add(withoutSuffix);
    }

    if (tokens.length > 1) {
      const tokenSignature = [...tokens].sort().join(" ");
      if (tokenSignature !== normalized && isUsefulIdentity(tokenSignature)) {
        set.add(tokenSignature);
      }
    }
  }
}

function titleWithoutTrailingQualifier(value: string) {
  return String(value ?? "")
    .replace(/\s*[\[(][^\])]+[\])]\s*$/, "")
    .trim();
}

export function sourceIdentityCandidates(item: SourceManga) {
  const identities = new Set<string>();
  const english = sourceEnglishTitle(item);
  if (english) addIdentity(identities, english);

  const plainTitle = titleWithoutTrailingQualifier(item.title);
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

function numericSignature(value: string) {
  return normalizeSourceIdentity(value).match(/\d+(?:\.\d+)?/g)?.join("|") ?? "";
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function tokenSimilarity(a: string, b: string) {
  const left = new Set(identityTokens(a));
  const right = new Set(identityTokens(b));
  if (!left.size || !right.size) return 0;

  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union ? common / union : 0;
}

function identitiesLikelySame(a: string, b: string) {
  if (a === b) return true;

  const aNumbers = numericSignature(a);
  const bNumbers = numericSignature(b);
  if ((aNumbers || bNumbers) && aNumbers !== bNumbers) return false;

  const aTokens = identityTokens(a);
  const bTokens = identityTokens(b);
  if (!aTokens.length || !bTokens.length) return false;

  const aSignature = [...aTokens].sort().join(" ");
  const bSignature = [...bTokens].sort().join(" ");
  if (aSignature === bSignature && isUsefulIdentity(aSignature)) return true;

  const compactA = aTokens.join("");
  const compactB = bTokens.join("");
  const maxLength = Math.max(compactA.length, compactB.length);
  const minLength = Math.min(compactA.length, compactB.length);
  if (minLength >= 10 && maxLength - minLength <= Math.max(2, Math.floor(maxLength * 0.08))) {
    const maxDistance = Math.max(1, Math.floor(maxLength * 0.08));
    if (levenshteinDistance(compactA, compactB) <= maxDistance) return true;
  }

  if (
    aTokens.length >= 3 &&
    bTokens.length >= 3 &&
    minLength / maxLength >= 0.82 &&
    tokenSimilarity(a, b) >= 0.86
  ) {
    return true;
  }

  return false;
}

function itemsLikelySame(
  a: SourceManga,
  b: SourceManga,
  aIdentities: Set<string>,
  bIdentities: Set<string>,
) {
  if (a.source === b.source) return false;
  if (intersects(aIdentities, bIdentities)) return true;

  for (const left of aIdentities) {
    for (const right of bIdentities) {
      if (identitiesLikelySame(left, right)) return true;
    }
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
  if (!uniqueItems.length) return [];

  const identities = uniqueItems.map(sourceIdentityCandidates);
  const parents = uniqueItems.map((_, index) => index);
  const componentSources = uniqueItems.map((item) => new Set<SourceName>([item.source]));

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };

  const union = (leftIndex: number, rightIndex: number) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) return;

    const leftSources = componentSources[leftRoot];
    const rightSources = componentSources[rightRoot];
    for (const source of leftSources) {
      if (rightSources.has(source)) return;
    }

    parents[rightRoot] = leftRoot;
    for (const source of rightSources) leftSources.add(source);
  };

  for (let left = 0; left < uniqueItems.length; left += 1) {
    for (let right = left + 1; right < uniqueItems.length; right += 1) {
      if (
        itemsLikelySame(
          uniqueItems[left],
          uniqueItems[right],
          identities[left],
          identities[right],
        )
      ) {
        union(left, right);
      }
    }
  }

  const grouped = new Map<number, { firstIndex: number; items: SourceManga[] }>();
  uniqueItems.forEach((item, index) => {
    const root = find(index);
    const existing = grouped.get(root);
    if (existing) {
      existing.items.push(item);
      existing.firstIndex = Math.min(existing.firstIndex, index);
    } else {
      grouped.set(root, { firstIndex: index, items: [item] });
    }
  });

  return [...grouped.values()]
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map(({ items: groupedItems }) => ({
      id: groupedItems.map((entry) => entry.key).sort().join("|"),
      primary: pickPrimary(groupedItems),
      items: groupedItems,
    }));
}

function queryScoreForItem(item: SourceManga, query: string) {
  const needle = normalizeSourceIdentity(query);
  if (!needle) return 1000;

  const title = normalizeSourceIdentity(item.title);
  const english = normalizeSourceIdentity(sourceEnglishTitle(item));
  const slug = normalizeSourceIdentity(item.slug.replace(/[-_]+/g, " "));
  const candidates = [...new Set([title, english, slug].filter(Boolean))];

  if (candidates.some((value) => value === needle)) return 0;

  const queryTokens = identityTokens(needle);
  const querySignature = [...queryTokens].sort().join(" ");
  if (
    querySignature &&
    candidates.some((value) => [...identityTokens(value)].sort().join(" ") === querySignature)
  ) {
    return 1;
  }

  if (candidates.some((value) => value.startsWith(needle + " "))) return 10;
  if (candidates.some((value) => value.includes(needle))) return 20;

  if (
    queryTokens.length &&
    candidates.some((value) => {
      const tokens = new Set(identityTokens(value));
      return queryTokens.every((token) => tokens.has(token));
    })
  ) {
    return 30;
  }

  let bestOverlap = 0;
  for (const value of candidates) {
    bestOverlap = Math.max(bestOverlap, tokenSimilarity(needle, value));
  }
  if (bestOverlap > 0) return 50 - bestOverlap * 10;

  return 100;
}

export function rankSourceGroupsByQuery(groups: SourceGroup[], query: string) {
  if (!query.trim()) return groups;
  return groups
    .map((group, index) => ({
      group,
      index,
      score: Math.min(...group.items.map((item) => queryScoreForItem(item, query))),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ group }) => group);
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
  return /^(?:mt|tx|aq|sz|xs|ml|md):[A-Za-z0-9_-]{1,110}$/.test(value);
}
