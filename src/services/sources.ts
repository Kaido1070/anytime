import type {
  SourceChapterPayload,
  SourceListResponse,
  SourceManga,
  SourceName,
} from "../types";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "تعذر الوصول إلى مصدر القراءة.");
  }
  return payload as T;
}

function params(input: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

function originalImageUrl(source: SourceName, url: string) {
  if (source !== "teamx") return url;

  // Team-X/OlympusStaff uses `thumbnail_` copies for list/search cards.
  // Removing that prefix points to the original full-size cover, which is
  // also how current Team-X reader extensions obtain the non-thumbnail art.
  return url.replace(/thumbnail_/gi, "");
}

export const sourceService = {
  async latest(source: SourceName, page = 1) {
    return api<SourceListResponse>(
      `/api/source/latest?${params({ source, page })}`,
    );
  },

  async popular(source: SourceName, page = 1) {
    return api<SourceListResponse>(
      `/api/source/popular?${params({ source, page })}`,
    );
  },

  async search(source: SourceName, query: string, page = 1) {
    return api<SourceListResponse>(
      `/api/source/search?${params({ source, q: query, page })}`,
    );
  },

  async getSeries(key: string) {
    const payload = await api<{ item: SourceManga }>(
      `/api/source/series?${params({ key })}`,
    );
    return payload.item;
  },

  async getChapter(key: string, chapter: number) {
    const payload = await api<{ chapter: SourceChapterPayload }>(
      `/api/source/chapter?${params({ key, number: chapter })}`,
    );
    return payload.chapter;
  },

  async resolve(keys: string[]) {
    if (!keys.length) return [];
    const payload = await api<{ items: SourceManga[] }>(
      `/api/source/resolve?${params({ keys: keys.join(",") })}`,
    );
    return payload.items;
  },

  imageUrl(source: SourceName, url?: string, referer?: string) {
    if (!url) return "";
    const original = originalImageUrl(source, url);
    return `/api/source/image?${params({ source, url: original, referer })}`;
  },

  isSourceKey(key?: string | null) {
    return Boolean(key && /^(mt|tx):/.test(key));
  },

  sourceLabel(source: SourceName) {
    return source === "mangatime" ? "MangaTime" : "Team-X";
  },
};
