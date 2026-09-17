const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const TEAMX_BASE = "https://olympustaff.com";
const ASQ_BASE = "https://3asq.online";
const STARZ_BASE = "https://starzmanga.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let sourceSchemaReady;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/source\/?/, "").split("/")[0] || "health";

  if (request.method === "GET" && action === "health") {
    return json({
      ok: true,
      phase: 3,
      sources: [
        { id: "mangatime", name: "MangaTime", mode: "trpc" },
        { id: "teamx", name: "Team-X", mode: "html" },
        { id: "3asq", name: "3asq", mode: "html" },
        { id: "starzmanga", name: "StarzManga", mode: "madara" },
      ],
    });
  }

  const db = env?.DB;
  if (!db) {
    return json(
      { error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع." },
      503,
    );
  }

  const session = await getSession(request, db);
  if (!session) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }

  try {
    await ensureSourceSchema(db);

    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    if (action === "latest") {
      const source = sourceFromQuery(url);
      const page = safePage(url.searchParams.get("page"));
      const payload = source === "mangatime"
        ? await mangaTimeList(db, { page, sortBy: "recent" })
        : source === "teamx"
          ? await teamXLatest(db, page)
          : source === "3asq"
            ? await asqLatest(db, page)
            : await starzLatest(db, page);
      return json(payload, 200, shortCache());
    }

    if (action === "popular") {
      const source = sourceFromQuery(url);
      const page = safePage(url.searchParams.get("page"));
      const payload = source === "mangatime"
        ? await mangaTimeList(db, { page, sortBy: "popularity" })
        : source === "teamx"
          ? await teamXPopular(db, page)
          : source === "3asq"
            ? await asqPopular(db, page)
            : await starzPopular(db, page);
      return json(payload, 200, shortCache());
    }

    if (action === "search") {
      const source = sourceFromQuery(url);
      const query = String(url.searchParams.get("q") ?? "").trim().slice(0, 120);
      if (!query) return json({ items: [], hasMore: false });
      const page = safePage(url.searchParams.get("page"));
      const payload = source === "mangatime"
        ? await mangaTimeList(db, { page, sortBy: "popularity", query })
        : source === "teamx"
          ? await teamXSearch(db, query)
          : source === "3asq"
            ? await asqSearch(db, query, page)
            : await starzSearch(db, query, page);
      return json(payload, 200, shortCache());
    }

    if (action === "resolve") {
      const keys = String(url.searchParams.get("keys") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
        .slice(0, 60);
      return json({ items: await resolveItems(db, keys) }, 200, shortCache());
    }

    if (action === "series") {
      const key = safeSourceKey(url.searchParams.get("key"));
      if (!key) return json({ error: "INVALID_SOURCE_KEY" }, 400);
      const item = await loadItem(db, key);
      if (!item) return json({ error: "SOURCE_ITEM_NOT_FOUND" }, 404);
      const detail = item.source === "mangatime"
        ? await mangaTimeSeries(db, item)
        : item.source === "teamx"
          ? await teamXSeries(db, item)
          : item.source === "3asq"
            ? await asqSeries(db, item)
            : await starzSeries(db, item);
      return json({ item: detail }, 200, shortCache());
    }

    if (action === "chapter") {
      const key = safeSourceKey(url.searchParams.get("key"));
      const number = Number(url.searchParams.get("number"));
      if (!key || !Number.isFinite(number) || number < 0) {
        return json({ error: "INVALID_CHAPTER" }, 400);
      }
      const item = await loadItem(db, key);
      if (!item) return json({ error: "SOURCE_ITEM_NOT_FOUND" }, 404);
      const chapter = item.source === "mangatime"
        ? await mangaTimeChapter(context, db, item, number)
        : item.source === "teamx"
          ? await teamXChapter(db, item, number)
          : item.source === "3asq"
            ? await asqChapter(db, item, number)
            : await starzChapter(db, item, number);
      return json({ chapter }, 200, { "Cache-Control": "private, max-age=30" });
    }

    if (action === "image") {
      const source = sourceFromQuery(url);
      const raw = String(url.searchParams.get("url") ?? "");
      return proxyImage(source, raw);
    }

    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    console.error("Anytime source error", error);
    if (error instanceof SourceError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    return json(
      { error: "SOURCE_ERROR", message: "تعذر الوصول إلى مصدر القراءة الآن. حاول مرة ثانية." },
      502,
    );
  }
}

class SourceError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function sourceFromQuery(url) {
  const source = String(url.searchParams.get("source") ?? "mangatime").toLowerCase();
  if (source !== "mangatime" && source !== "teamx" && source !== "3asq" && source !== "starzmanga") {
    throw new SourceError("UNKNOWN_SOURCE", "المصدر غير معروف.", 400);
  }
  return source;
}

function safePage(value) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page > 0 && page <= 100 ? page : 1;
}

function safeSourceKey(value) {
  const key = String(value ?? "").trim();
  return /^(mt|tx|aq|sz):[A-Za-z0-9_-]{1,110}$/.test(key) ? key : "";
}

function shortCache() {
  return { "Cache-Control": "private, max-age=45" };
}

async function ensureSourceSchema(db) {
  if (!sourceSchemaReady) {
    sourceSchemaReady = db
      .prepare(`CREATE TABLE IF NOT EXISTS source_items (
        source_key TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        cover_url TEXT NOT NULL DEFAULT '',
        description TEXT,
        status TEXT,
        genres_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        UNIQUE(source, source_id)
      )`)
      .run()
      .catch((error) => {
        sourceSchemaReady = null;
        throw error;
      });
  }
  await sourceSchemaReady;
}

async function rememberItems(db, items) {
  if (!items.length) return;
  const now = Date.now();
  const statements = items.slice(0, 80).map((item) =>
    db
      .prepare(`INSERT INTO source_items
        (source_key, source, source_id, slug, type, url, title, cover_url, description, status, genres_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET
          source_id = excluded.source_id,
          slug = excluded.slug,
          type = excluded.type,
          url = excluded.url,
          title = excluded.title,
          cover_url = CASE WHEN excluded.cover_url <> '' THEN excluded.cover_url ELSE source_items.cover_url END,
          description = COALESCE(excluded.description, source_items.description),
          status = COALESCE(excluded.status, source_items.status),
          genres_json = CASE WHEN excluded.genres_json <> '[]' THEN excluded.genres_json ELSE source_items.genres_json END,
          updated_at = excluded.updated_at`)
      .bind(
        item.key,
        item.source,
        item.sourceId,
        item.slug,
        item.type ?? "",
        item.url ?? "",
        item.title,
        item.cover ?? "",
        item.description ?? null,
        item.status ?? null,
        JSON.stringify(item.genres ?? []),
        now,
      ),
  );
  await db.batch(statements);
}

async function loadItem(db, key) {
  const row = await db
    .prepare("SELECT * FROM source_items WHERE source_key = ? LIMIT 1")
    .bind(key)
    .first();
  return row ? rowToItem(row) : null;
}

async function resolveItems(db, keys) {
  if (!keys.length) return [];
  const valid = keys.filter(safeSourceKey);
  if (!valid.length) return [];
  const placeholders = valid.map(() => "?").join(",");
  const result = await db
    .prepare(`SELECT * FROM source_items WHERE source_key IN (${placeholders})`)
    .bind(...valid)
    .all();
  const map = new Map((result.results ?? []).map((row) => [row.source_key, rowToItem(row)]));
  return valid.map((key) => map.get(key)).filter(Boolean);
}

function rowToItem(row) {
  return {
    key: row.source_key,
    source: row.source,
    sourceId: row.source_id,
    slug: row.slug,
    type: row.type,
    url: row.url,
    title: row.title,
    cover: row.cover_url,
    description: row.description ?? "",
    status: row.status ?? "",
    genres: parseJsonArray(row.genres_json),
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// MangaTime -----------------------------------------------------------------

async function mangaTimeList(db, { page, sortBy, query = null }) {
  const result = await mangaTimeTrpc("search.searchSeries", {
    page,
    limit: 24,
    sortBy,
    sortOrder: "desc",
    query,
  });
  const items = await Promise.all(
    (result?.results ?? []).map(async (row) => ({
      key: await makeSourceKey("mt", String(row.id)),
      source: "mangatime",
      sourceId: String(row.id),
      slug: String(row.slug ?? ""),
      type: String(row.type ?? "manga"),
      url: `${MANGATIME_BASE}/${encodeURIComponent(String(row.type ?? "manga"))}/${encodeURIComponent(String(row.slug ?? ""))}`,
      title: String(row.title ?? row.slug ?? "بدون عنوان"),
      cover: absoluteUrl(MANGATIME_BASE, row.coverUrl),
      description: "",
      status: "",
      genres: mangaTimeTypeGenres(row.type),
    })),
  );
  await rememberItems(db, items);
  return { items, hasMore: Boolean(result?.hasMore), page };
}

async function mangaTimeSeries(db, item) {
  const [detail, chapterPayload] = await Promise.all([
    mangaTimeTrpc("content.getSeriesBySlug", { slug: item.slug }),
    mangaTimeTrpc("content.getChapters", { seriesId: item.sourceId, limit: -1 }),
  ]);

  const chapters = (chapterPayload?.chapters ?? [])
    .map((chapter) => ({
      number: Number(chapter.number),
      title: String(chapter.title ?? `الفصل ${chapter.number}`),
      publishedAt: chapter.publishedAt ?? null,
    }))
    .filter((chapter) => Number.isFinite(chapter.number))
    .sort((a, b) => b.number - a.number);

  const updated = {
    ...item,
    slug: String(detail?.slug ?? item.slug),
    type: String(detail?.type ?? item.type),
    title: String(detail?.title ?? item.title),
    cover: absoluteUrl(MANGATIME_BASE, detail?.coverUrl ?? item.cover),
    description: String(detail?.description ?? ""),
    status: normalizeStatus(detail?.status),
    genres: mangaTimeSeriesGenres(detail, item),
    latest: chapters[0]?.number ?? null,
    chapters,
  };
  await rememberItems(db, [updated]);
  return updated;
}

function mangaTimeTypeGenres(type) {
  const raw = String(type ?? "").trim();
  if (!raw) return [];
  return isNovelLabel(raw) ? [raw, "روايات"] : [raw];
}

function mangaTimeSeriesGenres(detail, item) {
  const values = [
    ...(Array.isArray(detail?.genres) ? detail.genres.map((genre) => String(genre?.name ?? "")) : []),
    String(detail?.type ?? item?.type ?? ""),
  ].filter(Boolean);

  if (values.some(isNovelLabel)) values.push("روايات");
  return [...new Set(values)];
}

function isNovelLabel(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return /(?:^|\s)(?:novel|web novel|light novel)(?:$|\s)/i.test(normalized) ||
    /رواي(?:ة|ات)/.test(normalized);
}

async function mangaTimeChapter(context, db, item, number) {
  if (!Number.isInteger(number)) {
    throw new SourceError("UNSUPPORTED_CHAPTER", "هذا المصدر يتطلب رقم فصل صحيح.", 400);
  }
  const result = await mangaTimeTrpc("content.getChapterPages", {
    seriesSlug: item.slug,
    chapterNumber: number,
  });
  if (!result?.isUnlocked) {
    throw new SourceError("CHAPTER_LOCKED", "هذا الفصل مقفل في المصدر.", 423);
  }

  const series = await mangaTimeSeries(db, item);
  const pages = (result?.pages ?? []).map((page) => absoluteUrl(MANGATIME_BASE, page)).filter(Boolean);
  if (!pages.length) throw new SourceError("NO_PAGES", "المصدر لم يرجع صور الفصل.", 502);

  const navigation = chapterNavigation(series.chapters ?? [], number);
  if (result?.seriesId && result?.id) {
    context.waitUntil?.(
      mangaTimeTrackView(String(result.seriesId), String(result.id)).catch(() => undefined),
    );
  }
  return {
    item: series,
    number,
    title: series.chapters?.find((chapter) => chapter.number === number)?.title ?? `الفصل ${number}`,
    pages,
    ...navigation,
  };
}

async function mangaTimeTrpc(endpoint, input) {
  const url = new URL(`${MANGATIME_BASE}/api/trpc/${endpoint}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
  const response = await fetch(url, {
    headers: sourceHeaders(MANGATIME_BASE, "application/json,text/plain,*/*"),
    cf: { cacheTtl: endpoint.startsWith("search.") ? 45 : 20, cacheEverything: true },
  });
  if (!response.ok) {
    throw new SourceError("MANGATIME_UPSTREAM", `MangaTime رجع HTTP ${response.status}.`, 502);
  }
  const payload = await response.json();
  const first = Array.isArray(payload) ? payload[0] : null;
  if (first?.error) {
    const message = first.error?.json?.message || first.error?.message || "MangaTime API error";
    throw new SourceError("MANGATIME_API", String(message), 502);
  }
  return first?.result?.data?.json;
}

async function mangaTimeTrackView(seriesId, chapterId) {
  await fetch(`${MANGATIME_BASE}/api/trpc/content.trackView`, {
    method: "POST",
    headers: {
      ...sourceHeaders(MANGATIME_BASE, "application/json,text/plain,*/*"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ "0": { json: { seriesId, chapterId } } }),
  });
}

// Team-X / OlympusStaff ------------------------------------------------------

async function teamXPopular(db, page) {
  const html = await teamXFetchText(`/series?page=${page}`);
  const items = await teamXItemsFromHtml(html);
  await rememberItems(db, items);
  return { items, hasMore: teamXHasNext(html), page };
}

async function teamXLatest(db, page) {
  const html = await teamXFetchText(`/?page=${page}`);
  const marker = html.search(/class=["\'][^"\']*post-body[^"\']*["\']/i);
  const scoped = marker >= 0 ? html.slice(marker) : html;
  const items = await teamXItemsFromHtml(scoped);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: teamXHasNext(html), page };
}

async function teamXSearch(db, query) {
  const html = await teamXFetchText(`/ajax/search?keyword=${encodeURIComponent(query)}`);
  const items = await teamXItemsFromHtml(html);
  await rememberItems(db, items);
  return { items, hasMore: false, page: 1 };
}

async function teamXItemsFromHtml(html) {
  const anchors = extractAnchors(html);
  const bySlug = new Map();
  for (const anchor of anchors) {
    const href = absoluteUrl(TEAMX_BASE, anchor.href);
    if (!href) continue;
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (!/^(www\.)?olympustaff\.com$/i.test(parsed.hostname)) continue;
    const match = parsed.pathname.match(/^\/series\/([^/]+)\/?$/i);
    if (!match) continue;
    const slug = decodeURIComponent(match[1]);
    if (!slug || bySlug.has(slug)) continue;
    const title = cleanText(
      firstMatch(anchor.inner, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
        anchor.attrs.title ||
        firstImgAttr(anchor.inner, "alt") ||
        stripTags(anchor.inner),
    );
    if (!title || /^image$/i.test(title)) continue;
    const cover = absoluteUrl(TEAMX_BASE, firstImgUrl(anchor.inner));
    bySlug.set(slug, {
      key: `tx:${safeSlugKey(slug)}`,
      source: "teamx",
      sourceId: slug,
      slug,
      type: "series",
      url: `${TEAMX_BASE}/series/${encodeURIComponent(slug)}`,
      title,
      cover,
      description: "",
      status: "",
      genres: [],
    });
  }
  return [...bySlug.values()].slice(0, 80);
}

async function teamXSeries(db, item) {
  const html = await teamXFetchText(item.url || `/series/${encodeURIComponent(item.slug)}`, false);
  const plain = cleanText(stripTags(html));
  const title = cleanText(
    firstMatch(html, /author-info-title[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      item.title,
  );
  const cover = absoluteUrl(
    TEAMX_BASE,
    firstMatch(html, /<img[^>]*class=["'][^"']*shadow-sm[^"']*["'][^>]*(?:src|data-src)=["']([^"']+)["']/i) ||
      firstMatch(html, /<img[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*class=["'][^"']*shadow-sm/i) ||
      item.cover,
  );
  const description = cleanText(
    firstMatch(html, /review-content[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) || "",
  );
  const status = normalizeStatus(
    firstMatch(plain, /الحالة\s*:?\s*(مستمرة|مكتملة|مكتمل|متوقف|متروك|موسم منتهي|قادم قريبًا)/i) || "",
  );
  const genres = extractGenreCandidates(html);
  const chapters = parseTeamXChapters(html, item.url || `${TEAMX_BASE}/series/${item.slug}`);
  const updated = {
    ...item,
    title,
    cover,
    description,
    status,
    genres,
    latest: chapters[0]?.number ?? null,
    chapters,
  };
  await rememberItems(db, [updated]);
  return updated;
}

function parseTeamXChapters(html, seriesUrl) {
  const parsedBase = new URL(seriesUrl, TEAMX_BASE);
  const basePath = parsedBase.pathname.replace(/\/$/, "");
  const found = new Map();
  for (const anchor of extractAnchors(html)) {
    const href = absoluteUrl(TEAMX_BASE, anchor.href);
    if (!href) continue;
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.pathname === basePath) continue;
    if (!parsed.pathname.startsWith(`${basePath}/`)) continue;
    const tail = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(tail)) continue;
    const number = Number(tail);
    if (!Number.isFinite(number)) continue;
    const title = cleanText(stripTags(anchor.inner)) || `الفصل ${tail}`;
    found.set(number, { number, title, publishedAt: null, url: href });
  }

  const numbers = [...found.keys()].sort((a, b) => b - a);
  if (numbers.length) {
    const top = Math.floor(numbers[0]);
    const bottom = Math.max(0, Math.floor(numbers[numbers.length - 1]));
    if (top - bottom <= 2500) {
      for (let number = top; number >= bottom; number -= 1) {
        if (!found.has(number)) {
          found.set(number, {
            number,
            title: `الفصل ${number}`,
            publishedAt: null,
            url: `${parsedBase.origin}${basePath}/${number}`,
          });
        }
      }
    }
  }

  return [...found.values()].sort((a, b) => b.number - a.number);
}

async function teamXChapter(db, item, number) {
  const series = await teamXSeries(db, item);
  const selected = series.chapters?.find((chapter) => chapter.number === number);
  const chapterUrl = selected?.url || `${item.url || `${TEAMX_BASE}/series/${item.slug}`}/${number}`;
  const html = await teamXFetchText(chapterUrl, false);
  const pages = parseTeamXPages(html);
  if (!pages.length) {
    const plain = cleanText(stripTags(html));
    if (/فصل مدفوع|شراء الفصل|locked|premium/i.test(plain)) {
      throw new SourceError("CHAPTER_LOCKED", "هذا الفصل يحتاج فتحه من المصدر.", 423);
    }
    throw new SourceError("NO_PAGES", "Team-X لم يرجع صور الفصل.", 502);
  }
  return {
    item: series,
    number,
    title: selected?.title ?? `الفصل ${number}`,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

function parseTeamXPages(html) {
  const marker = html.search(/class=["'][^"']*image_list[^"']*["']/i);
  const scoped = marker >= 0 ? html.slice(marker, Math.min(html.length, marker + 1_500_000)) : html;
  const candidates = extractImages(scoped)
    .map((image) => absoluteUrl(TEAMX_BASE, image.src))
    .filter(Boolean);
  const unique = [...new Set(candidates)];
  if (marker >= 0) return unique.filter((url) => !isLikelyUiImage(url));
  return unique.filter((url) => /episode|chapter|uploads|storage|cdn/i.test(url) && !isLikelyUiImage(url));
}

function isLikelyUiImage(url) {
  return /logo|avatar|favicon|icon|profile|ads?|banner/i.test(url);
}

async function teamXFetchText(pathOrUrl, useBase = true) {
  const target = useBase ? new URL(pathOrUrl, TEAMX_BASE).toString() : new URL(pathOrUrl, TEAMX_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(TEAMX_BASE, "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      throw new SourceError("TEAMX_BLOCKED", "Team-X رفض الطلب مؤقتًا.", 502);
    }
    throw new SourceError("TEAMX_UPSTREAM", `Team-X رجع HTTP ${response.status}.`, 502);
  }
  return response.text();
}

function teamXHasNext(html) {
  return /<a[^>]+rel=["']next["'][^>]*href=["'][^"']+["']/i.test(html);
}


// 3asq / Manga Al-Ashiq ------------------------------------------------------

async function asqLatest(db, page) {
  return asqList(db, { page, order: "latest" });
}

async function asqPopular(db, page) {
  return asqList(db, { page, order: "views" });
}

async function asqList(db, { page, order }) {
  const path = "/manga/page/" + page + "/?m_orderby=" + encodeURIComponent(order);
  const html = await asqFetchText(path);
  const items = await asqItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: asqHasNext(html), page };
}

async function asqSearch(db, query, page) {
  const prefix = page > 1 ? "/page/" + page + "/" : "/";
  const html = await asqFetchText(
    prefix + "?s=" + encodeURIComponent(query) + "&post_type=wp-manga",
  );
  const items = await asqItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: asqHasNext(html), page };
}

async function asqItemsFromHtml(html) {
  const bySlug = new Map();
  const blocks = madaraBlocksByClass(html, ["c-tabs-item__content", "page-item-detail"]);
  const candidates = blocks.length ? blocks : [String(html ?? "")];

  for (const block of candidates) {
    for (const anchor of extractAnchors(block)) {
      const href = absoluteUrl(ASQ_BASE, anchor.href);
      if (!href) continue;
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }
      if (!/^(?:www\.)?3asq\.online$/i.test(parsed.hostname)) continue;
      const match = parsed.pathname.match(/^\/manga\/([^/]+)\/?$/i);
      if (!match) continue;

      const slug = decodeURIComponent(match[1]);
      if (!slug || bySlug.has(slug)) continue;

      const title = cleanText(
        anchor.attrs.title ||
          firstMatch(anchor.inner, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
          firstImgAttr(block, "alt") ||
          stripTags(anchor.inner),
      );
      if (!title || /^image$/i.test(title)) continue;

      const cover = absoluteUrl(ASQ_BASE, asqFirstImage(block));
      bySlug.set(slug, {
        key: "aq:" + safeSlugKey(slug),
        source: "3asq",
        sourceId: slug,
        slug,
        type: "manga",
        url: ASQ_BASE + "/manga/" + encodeURIComponent(slug) + "/",
        title,
        cover,
        description: "",
        status: "",
        genres: [],
      });
      break;
    }
  }

  return [...bySlug.values()].slice(0, 80);
}

async function asqSeries(db, item) {
  const html = await asqFetchText(item.url || "/manga/" + encodeURIComponent(item.slug) + "/", false);
  const title = cleanText(
    firstMatch(html, /post-title[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(html, /id=["']manga-title["'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      item.title,
  );

  const summaryImage =
    firstMatch(html, /<div\b[^>]*class=["'][^"']*\bsummary_image\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    "";
  const cover = absoluteUrl(ASQ_BASE, asqFirstImage(summaryImage) || item.cover);
  const description = cleanText(
    firstMatch(html, /description-summary[^>]*>([\s\S]*?)<\/div>/i) ||
      firstMatch(html, /manga-excerpt[^>]*>([\s\S]*?)<\/div>/i) ||
      "",
  );

  const plain = cleanText(stripTags(html));
  const status = normalizeStatus(
    firstMatch(plain, /الحالة\s*:?[\s-]*(مستمرة|مستمر|مكتملة|مكتمل|متوقف|متروك)/i) ||
      firstMatch(plain, /status\s*:?[\s-]*(ongoing|completed|hiatus|cancelled|canceled)/i) ||
      "",
  );

  const sourceType = normalizeAsqType(
    firstMatch(plain, /النوع\s*:?\s*(رواية ويب|رواية|مانجا ويب|مانهوا|مانجا|كوميك)/i) ||
      firstMatch(plain, /type\s*:?\s*(web novel|light novel|novel|webtoon|manhwa|manga|comic)/i) ||
      item.type,
  );
  const genres = asqGenres(html);
  if (sourceType === "novel" || sourceType === "web-novel") genres.push("روايات");
  const normalizedGenres = [...new Set(genres)];
  const chapters = parseAsqChapters(html, item.url || ASQ_BASE + "/manga/" + item.slug + "/");
  const updated = {
    ...item,
    type: sourceType || item.type,
    title,
    cover,
    description,
    status,
    genres: normalizedGenres,
    latest: chapters[0]?.number ?? null,
    chapters,
  };
  await rememberItems(db, [updated]);
  return updated;
}

function normalizeAsqType(value) {
  const type = cleanText(value).toLowerCase();
  if (/رواية\s*ويب|web\s*novel/.test(type)) return "web-novel";
  if (/رواية|light\s*novel|novel/.test(type)) return "novel";
  if (/مانهوا|manhwa/.test(type)) return "manhwa";
  if (/مانجا\s*ويب|webtoon/.test(type)) return "webtoon";
  if (/مانجا|manga/.test(type)) return "manga";
  if (/كوميك|comic/.test(type)) return "comic";
  return type || "manga";
}

function parseAsqChapters(html, seriesUrl) {
  const base = new URL(seriesUrl, ASQ_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const found = new Map();
  const regex = /<li\b[^>]*class=["'][^"']*\bwp-manga-chapter\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = regex.exec(String(html ?? "")))) {
    const block = match[1];
    const anchor = extractAnchors(block).find((entry) => {
      const href = absoluteUrl(ASQ_BASE, entry.href);
      if (!href) return false;
      try {
        const parsed = new URL(href);
        return parsed.pathname.startsWith(basePath + "/") && parsed.pathname !== basePath + "/";
      } catch {
        return false;
      }
    });
    if (!anchor) continue;

    const url = absoluteUrl(ASQ_BASE, anchor.href);
    if (!url) continue;
    const parsed = new URL(url);
    const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    const title = cleanText(stripTags(anchor.inner)) || chapterId;
    const number = asqChapterNumber(title, chapterId);
    if (!Number.isFinite(number)) continue;

    found.set(number, {
      number,
      title: title || "الفصل " + number,
      publishedAt: null,
      url,
    });
  }

  return [...found.values()].sort((a, b) => b.number - a.number);
}

function asqChapterNumber(title, chapterId) {
  const values = [String(title ?? ""), String(chapterId ?? "").replace(/_/g, ".")];
  for (const value of values) {
    const explicit = value.match(/(?:الفصل|chapter|chap|ch)\s*[-#:]?\s*(\d+(?:\.\d+)?)/i);
    if (explicit) return Number(explicit[1]);
    const numeric = value.match(/(?:^|[^0-9])(\d+(?:\.\d+)?)(?:[^0-9]|$)/);
    if (numeric) return Number(numeric[1]);
  }
  return Number.NaN;
}

async function asqChapter(db, item, number) {
  const series = await asqSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );
  if (!selected?.url) {
    throw new SourceError("CHAPTER_NOT_FOUND", "الفصل غير موجود في العاشق.", 404);
  }

  const chapterUrl = new URL(selected.url, ASQ_BASE);
  chapterUrl.searchParams.set("style", "list");
  const html = await asqFetchText(chapterUrl.toString(), false);
  const pages = parseAsqPages(html);
  if (!pages.length) {
    throw new SourceError("NO_PAGES", "العاشق لم يرجع صور الفصل.", 502);
  }

  return {
    item: series,
    number,
    title: selected.title || "الفصل " + number,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

function parseAsqPages(html) {
  const source = String(html ?? "");
  const pageBlocks = madaraBlocksByClass(source, ["page-break"]);
  const pages = [];

  for (const block of pageBlocks) {
    const image = asqFirstImage(block);
    const url = absoluteUrl(ASQ_BASE, image);
    if (url && !isAsqUiImage(url)) pages.push(url);
  }
  if (pages.length) return [...new Set(pages)];

  const marker = source.search(/class=["'][^"']*\breading-content\b[^"']*["']/i);
  const tail = marker >= 0 ? source.slice(marker) : source;
  const footer = tail.search(/(?:id=["'](?:comments|manga-discussion)["']|<footer\b)/i);
  const scoped = footer >= 0 ? tail.slice(0, footer) : tail;

  const regex = /<img\b([^>]*)>/gi;
  let match;
  while ((match = regex.exec(scoped))) {
    const attrs = parseAttrs(match[1]);
    const raw = asqImageFromAttrs(attrs);
    const url = absoluteUrl(ASQ_BASE, raw);
    if (!url || isAsqUiImage(url)) continue;
    pages.push(url);
  }
  return [...new Set(pages)];
}

function asqGenres(html) {
  const block =
    firstMatch(html, /genres-content[^>]*>([\s\S]*?)<\/div>/i) ||
    firstMatch(html, /manga-genres[^>]*>([\s\S]*?)<\/div>/i) ||
    "";
  return [...new Set(
    extractAnchors(block)
      .map((anchor) => cleanText(stripTags(anchor.inner)))
      .filter((value) => value && value.length <= 60),
  )];
}

function madaraBlocksByClass(html, classNames) {
  const names = classNames.join("|");
  const regex = new RegExp(
    '<div\\b[^>]*class=["\'][^"\']*(?:' + names + ')[^"\']*["\'][^>]*>',
    "gi",
  );
  const source = String(html ?? "");
  const starts = [];
  let match;
  while ((match = regex.exec(source))) starts.push(match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function asqFirstImage(html) {
  const regex = /<img\b([^>]*)>/gi;
  let match;
  while ((match = regex.exec(String(html ?? "")))) {
    const attrs = parseAttrs(match[1]);
    const value = asqImageFromAttrs(attrs);
    if (value && !String(value).startsWith("data:")) return value;
  }
  return "";
}

function asqImageFromAttrs(attrs) {
  return attrs["data-src"] ||
    attrs["data-lazy-src"] ||
    bestSrcset(attrs.srcset) ||
    attrs.src ||
    "";
}

function isAsqUiImage(url) {
  return /(?:logo|avatar|favicon|icon|profile)(?:[\/_-]|\.)/i.test(url);
}

async function asqFetchText(pathOrUrl, useBase = true) {
  const target = new URL(pathOrUrl, ASQ_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(
      ASQ_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      throw new SourceError("ASQ_BLOCKED", "العاشق رفض الطلب مؤقتًا.", 502);
    }
    throw new SourceError("ASQ_UPSTREAM", "العاشق رجع HTTP " + response.status + ".", 502);
  }
  return response.text();
}

function asqHasNext(html) {
  return /<a\b[^>]*(?:rel=["']next["']|class=["'][^"']*\bnext\b[^"']*["'])[^>]*>/i.test(html);
}


// StarzManga / Manga Starz ---------------------------------------------------

async function starzLatest(db, page) {
  return starzList(db, { page, order: "latest" });
}

async function starzPopular(db, page) {
  return starzList(db, { page, order: "views" });
}

async function starzList(db, { page, order }) {
  const html = await starzFetchText("/manga/page/" + page + "/?m_orderby=" + encodeURIComponent(order));
  const items = await starzItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: starzHasNext(html), page };
}

async function starzSearch(db, query, page) {
  const prefix = page > 1 ? "/page/" + page + "/" : "/";
  const html = await starzFetchText(prefix + "?s=" + encodeURIComponent(query) + "&post_type=wp-manga");
  const items = await starzItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: starzHasNext(html), page };
}

async function starzItemsFromHtml(html) {
  const bySlug = new Map();
  const blocks = madaraBlocksByClass(html, ["c-tabs-item__content", "page-item-detail"]);
  const candidates = blocks.length ? blocks : [String(html ?? "")];

  for (const block of candidates) {
    for (const anchor of extractAnchors(block)) {
      const href = absoluteUrl(STARZ_BASE, anchor.href);
      if (!href) continue;
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }
      if (!/^(?:www\.)?starzmanga\.com$/i.test(parsed.hostname)) continue;
      const match = parsed.pathname.match(/^\/manga\/([^/]+)\/?$/i);
      if (!match) continue;

      const slug = decodeURIComponent(match[1]);
      if (!slug || bySlug.has(slug)) continue;

      const title = cleanText(
        anchor.attrs.title ||
          firstMatch(anchor.inner, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
          firstImgAttr(block, "alt") ||
          stripTags(anchor.inner),
      );
      if (!title || /^image$/i.test(title)) continue;

      const cover = absoluteUrl(STARZ_BASE, asqFirstImage(block));
      bySlug.set(slug, {
        key: "sz:" + safeSlugKey(slug),
        source: "starzmanga",
        sourceId: slug,
        slug,
        type: "manga",
        url: STARZ_BASE + "/manga/" + encodeURIComponent(slug) + "/",
        title,
        cover,
        description: "",
        status: "",
        genres: [],
      });
      break;
    }
  }

  return [...bySlug.values()].slice(0, 80);
}

async function starzSeries(db, item) {
  const seriesUrl = item.url || STARZ_BASE + "/manga/" + encodeURIComponent(item.slug) + "/";
  const html = await starzFetchText(seriesUrl, false);
  const title = cleanText(
    firstMatch(html, /post-title[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      item.title,
  );
  const summaryImage =
    firstMatch(html, /<div\b[^>]*class=["'][^"']*\bsummary_image\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    "";
  const cover = absoluteUrl(STARZ_BASE, asqFirstImage(summaryImage) || item.cover);
  const description = cleanText(
    firstMatch(html, /description-summary[^>]*>([\s\S]*?)<\/div>/i) ||
      firstMatch(html, /manga-excerpt[^>]*>([\s\S]*?)<\/div>/i) ||
      "",
  );
  const plain = cleanText(stripTags(html));
  const status = normalizeStatus(
    firstMatch(plain, /الحالة\s*:?\s*(مستمرة|مستمر|مكتملة|مكتمل|متوقف|متروك)/i) ||
      firstMatch(plain, /status\s*:?\s*(ongoing|completed|hiatus|cancelled|canceled)/i) ||
      "",
  );
  const type = normalizeAsqType(
    firstMatch(plain, /النوع\s*:?\s*(رواية ويب|رواية|مانجا ويب|مانهوا|مانجا|كوميك)/i) ||
      firstMatch(plain, /type\s*:?\s*(web novel|light novel|novel|webtoon|manhwa|manga|comic)/i) ||
      item.type,
  );
  const genres = asqGenres(html);
  if (type === "novel" || type === "web-novel") genres.push("روايات");

  const postId = starzPostId(html);
  let chapterHtml = html;
  if (postId) {
    chapterHtml = await starzFetchChapters(postId).catch(() => html);
  }
  const chapters = parseStarzChapters(chapterHtml, seriesUrl);
  const updated = {
    ...item,
    sourceId: postId || item.sourceId,
    type,
    title,
    cover,
    description,
    status,
    genres: [...new Set(genres)],
    latest: chapters[0]?.number ?? null,
    chapters,
  };
  await rememberItems(db, [updated]);
  return updated;
}

function starzPostId(html) {
  return cleanText(
    firstMatch(html, /id=["']manga-chapters-holder["'][^>]*data-id=["']([^"']+)["']/i) ||
      firstMatch(html, /data-id=["']([^"']+)["'][^>]*id=["']manga-chapters-holder["']/i) ||
      firstMatch(html, /class=["'][^"']*rating-post-id[^"']*["'][^>]*value=["']([^"']+)["']/i) ||
      firstMatch(html, /value=["']([^"']+)["'][^>]*class=["'][^"']*rating-post-id/i) ||
      firstMatch(html, /data-post=["']([^"']+)["']/i),
  );
}

async function starzFetchChapters(postId) {
  const body = new URLSearchParams({
    action: "manga_get_chapters",
    manga: String(postId),
  });
  const response = await fetch(STARZ_BASE + "/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: {
      ...sourceHeaders(STARZ_BASE, "text/html,application/xhtml+xml,*/*;q=0.8"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: false },
  });
  if (!response.ok) throw new SourceError("STARZ_CHAPTERS", "StarzManga لم يرجع قائمة الفصول.", 502);
  return response.text();
}

function parseStarzChapters(html, seriesUrl) {
  const base = new URL(seriesUrl, STARZ_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const found = new Map();
  const regex = /<li\b[^>]*class=["'][^"']*\bwp-manga-chapter\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = regex.exec(String(html ?? "")))) {
    const block = match[1];
    const anchor = extractAnchors(block).find((entry) => {
      const href = absoluteUrl(STARZ_BASE, entry.href);
      if (!href) return false;
      try {
        const parsed = new URL(href);
        return parsed.pathname.startsWith(basePath + "/") && parsed.pathname !== basePath + "/";
      } catch {
        return false;
      }
    });
    if (!anchor) continue;

    const url = absoluteUrl(STARZ_BASE, anchor.href);
    if (!url) continue;
    const parsed = new URL(url);
    const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    const title = cleanText(stripTags(anchor.inner)) || chapterId;
    const number = asqChapterNumber(title, chapterId);
    if (!Number.isFinite(number)) continue;
    found.set(number, { number, title: title || "الفصل " + number, publishedAt: null, url });
  }
  return [...found.values()].sort((a, b) => b.number - a.number);
}

async function starzChapter(db, item, number) {
  const series = await starzSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );
  if (!selected?.url) {
    throw new SourceError("CHAPTER_NOT_FOUND", "الفصل غير موجود في StarzManga.", 404);
  }
  const chapterUrl = new URL(selected.url, STARZ_BASE);
  chapterUrl.searchParams.set("style", "list");
  const html = await starzFetchText(chapterUrl.toString(), false);
  const pages = parseStarzPages(html);
  if (!pages.length) throw new SourceError("NO_PAGES", "StarzManga لم يرجع صور الفصل.", 502);

  return {
    item: series,
    number,
    title: selected.title || "الفصل " + number,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

function parseStarzPages(html) {
  const source = String(html ?? "");
  const pageBlocks = madaraBlocksByClass(source, ["page-break"]);
  const pages = [];
  for (const block of pageBlocks) {
    const raw = asqFirstImage(block);
    const url = absoluteUrl(STARZ_BASE, raw);
    if (url && !isStarzUiImage(url)) pages.push(url);
  }
  if (pages.length) return [...new Set(pages)];

  const marker = source.search(/class=["'][^"']*\breading-content\b[^"']*["']/i);
  const tail = marker >= 0 ? source.slice(marker) : source;
  const footer = tail.search(/(?:id=["'](?:comments|manga-discussion)["']|<footer\b)/i);
  const scoped = footer >= 0 ? tail.slice(0, footer) : tail;
  return [...new Set(
    extractImages(scoped)
      .map((image) => absoluteUrl(STARZ_BASE, image.src))
      .filter((url) => url && !isStarzUiImage(url)),
  )];
}

function isStarzUiImage(url) {
  return /(?:logo|avatar|favicon|icon|profile|banner|ads?)(?:[\/_-]|\.)/i.test(url);
}

async function starzFetchText(pathOrUrl, useBase = true) {
  const target = new URL(pathOrUrl, STARZ_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(
      STARZ_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      throw new SourceError("STARZ_BLOCKED", "StarzManga رفض الطلب مؤقتًا.", 502);
    }
    throw new SourceError("STARZ_UPSTREAM", "StarzManga رجع HTTP " + response.status + ".", 502);
  }
  return response.text();
}

function starzHasNext(html) {
  return /<a\b[^>]*(?:rel=["']next["']|class=["'][^"']*\bnext\b[^"']*["'])[^>]*>/i.test(html);
}

// Shared parsing & transport -------------------------------------------------

function chapterNavigation(chapters, number) {
  const sorted = [...new Set(chapters.map((chapter) => Number(chapter.number)).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const index = sorted.findIndex((value) => value === number);
  return {
    previous: index > 0 ? sorted[index - 1] : null,
    next: index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null,
  };
}

async function proxyImage(source, rawUrl) {
  const base = source === "teamx"
    ? TEAMX_BASE
    : source === "3asq"
      ? ASQ_BASE
      : source === "starzmanga"
        ? STARZ_BASE
        : MANGATIME_BASE;
  const target = absoluteUrl(base, rawUrl);
  if (!target) return json({ error: "INVALID_IMAGE_URL" }, 400);

  const parsed = new URL(target);
  if (!["http:", "https:"].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return json({ error: "INVALID_IMAGE_HOST" }, 400);
  }

  const response = await fetch(target, {
    headers: sourceHeaders(base, "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"),
    redirect: "follow",
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!response.ok) return json({ error: "IMAGE_UPSTREAM", status: response.status }, 502);
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("image/")) {
    return json({ error: "NOT_AN_IMAGE" }, 502);
  }
  const headers = new Headers();
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  headers.set("X-Content-Type-Options", "nosniff");
  const length = response.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(response.body, { status: 200, headers });
}

function sourceHeaders(base, accept) {
  return {
    Accept: accept,
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: `${base}/`,
    "User-Agent": SOURCE_UA,
  };
}

function absoluteUrl(base, value) {
  if (value == null) return "";
  const raw = String(value).trim().replaceAll(" ", "%20");
  if (!raw) return "";
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
}

async function makeSourceKey(prefix, sourceId) {
  if (/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return `${prefix}:${sourceId}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceId));
  return `${prefix}:${bytesToBase64Url(new Uint8Array(digest)).slice(0, 24)}`;
}

function safeSlugKey(slug) {
  const normalized = String(slug).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  return normalized || "series";
}

function normalizeStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (["ongoing", "مستمرة", "مستمر"].includes(status)) return "ongoing";
  if (["completed", "مكتملة", "مكتمل"].includes(status)) return "completed";
  if (["hiatus", "متوقف", "موسم منتهي"].includes(status)) return "hiatus";
  if (["cancelled", "canceled", "متروك"].includes(status)) return "cancelled";
  return status;
}

function extractAnchors(html) {
  const out = [];
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) continue;
    out.push({ href: attrs.href, attrs, inner: match[2] });
  }
  return out;
}

function extractImages(html) {
  const out = [];
  const regex = /<img\b([^>]*)>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = parseAttrs(match[1]);
    const src = attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || bestSrcset(attrs.srcset);
    if (src) out.push({ src, attrs });
  }
  return out;
}

function firstImgUrl(html) {
  return extractImages(html)[0]?.src ?? "";
}

function firstImgAttr(html, name) {
  return extractImages(html)[0]?.attrs?.[name] ?? "";
}

function bestSrcset(value) {
  if (!value) return "";
  const parts = String(value)
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
  return parts.at(-1) ?? "";
}

function parseAttrs(input) {
  const attrs = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = regex.exec(input))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function extractGenreCandidates(html) {
  const block = firstMatch(html, /review-author-info[^>]*>([\s\S]*?)<\/div>/i) || "";
  const genres = [];
  for (const anchor of extractAnchors(block)) {
    const text = cleanText(stripTags(anchor.inner));
    if (text && text.length <= 40) genres.push(text);
  }
  return [...new Set(genres)];
}

function firstMatch(text, regex) {
  return text.match(regex)?.[1] ?? "";
}

function stripTags(value) {
  return String(value ?? "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/\s+/g, " ")
    .replace(/^غلاف\s+/i, "")
    .trim();
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return false;
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const row = await db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1")
    .bind(tokenHash, Date.now())
    .first();
  return row ? { userId: row.user_id } : null;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export const __test = {
  extractAnchors,
  extractImages,
  parseTeamXChapters,
  parseTeamXPages,
  parseAsqChapters,
  parseAsqPages,
  parseStarzChapters,
  parseStarzPages,
  starzPostId,
  asqChapterNumber,
  normalizeAsqType,
  mangaTimeTypeGenres,
  mangaTimeSeriesGenres,
  isNovelLabel,
  normalizeStatus,
};
