import type {
  SourceChapterPayload,
  SourceListResponse,
  SourceManga,
  SourceName,
} from "../types";

const coverRequests = new Map<string, Promise<string[]>>();
const chapterRequests = new Map<string, Promise<SourceChapterPayload>>();
const MAX_CHAPTER_REQUESTS = 8;

function rememberChapterRequest(key: string, request: Promise<SourceChapterPayload>) {
  chapterRequests.delete(key);
  chapterRequests.set(key, request);
  while (chapterRequests.size > MAX_CHAPTER_REQUESTS) {
    const oldest = chapterRequests.keys().next().value as string | undefined;
    if (!oldest) break;
    chapterRequests.delete(oldest);
  }
}

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
  // Removing that prefix points to the original full-size cover.
  return url.replace(/thumbnail_/gi, "");
}

function wordpressOriginalCover(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("w");
    parsed.searchParams.delete("width");
    parsed.searchParams.delete("h");
    parsed.searchParams.delete("height");
    parsed.searchParams.delete("resize");
    parsed.pathname = parsed.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]{2,5}$)/i, "");
    return parsed.toString();
  } catch {
    return url.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]{2,5}(?:\?|$))/i, "");
  }
}

function bloggerOriginalCover(url?: string) {
  if (!url) return "";
  return url
    .replace(/\/w\d+\//i, "/s0/")
    .replace(/\/s\d+(?:-c)?\//i, "/s0/")
    .replace(/=w\d+$/i, "=s0")
    .replace(/=s\d+(?:-c)?$/i, "=s0");
}

function uniqueCovers(values: Array<string | undefined>) {
  return values.filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
}

function coverFallbackCandidates(item: SourceManga) {
  if (item.source === "3asq" || item.source === "starzmanga" || item.source === "mangalik") {
    return uniqueCovers([wordpressOriginalCover(item.cover), item.cover]);
  }
  if (item.source === "xsano") {
    return uniqueCovers([bloggerOriginalCover(item.cover), item.cover]);
  }
  return uniqueCovers([item.cover]);
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
    const requestKey = `${key}:${chapter}`;
    const cached = chapterRequests.get(requestKey);
    if (cached) {
      rememberChapterRequest(requestKey, cached);
      return cached;
    }

    const request = api<{ chapter: SourceChapterPayload }>(
      `/api/source/chapter?${params({ key, number: chapter })}`,
    )
      .then((payload) => payload.chapter)
      .catch((cause) => {
        chapterRequests.delete(requestKey);
        throw cause;
      });

    rememberChapterRequest(requestKey, request);
    return request;
  },

  async resolve(keys: string[]) {
    if (!keys.length) return [];
    const payload = await api<{ items: SourceManga[] }>(
      `/api/source/resolve?${params({ keys: keys.join(",") })}`,
    );
    return payload.items;
  },

  coverFallbackCandidates(item: SourceManga) {
    return coverFallbackCandidates(item);
  },

  async coverCandidates(item: SourceManga) {
    const fallback = coverFallbackCandidates(item);
    if (item.source !== "mangatime" && item.source !== "3asq" && item.source !== "starzmanga" && item.source !== "xsano" && item.source !== "mangalik") return fallback;

    const cached = coverRequests.get(item.key);
    if (cached) return cached;

    const request = api<{ covers?: string[] }>(
      `/api/source/cover?${params({ key: item.key })}`,
    )
      .then((payload) => uniqueCovers([...(payload.covers ?? []), ...fallback]))
      .catch(() => fallback);

    coverRequests.set(item.key, request);
    return request;
  },

  imageUrl(source: SourceName, url?: string, referer?: string) {
    if (!url) return "";
    const original = originalImageUrl(source, url);
    return `/api/source/image?${params({ source, url: original, referer })}`;
  },

  isSourceKey(key?: string | null) {
    return Boolean(key && /^(mt|tx|aq|sz|xs|ml):/.test(key));
  },

  sourceLabel(source: SourceName) {
    if (source === "mangatime") return "MangaTime";
    if (source === "teamx") return "Team-X";
    if (source === "3asq") return "3asq";
    if (source === "starzmanga") return "StarzManga";
    if (source === "xsano") return "XSano Manga";
    return "MangaLik";
  },
};
