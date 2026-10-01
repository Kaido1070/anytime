const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const TEAMX_BASE = "https://olympustaff.com";
const ASQ_BASE = "https://3asq.online";
const STARZ_BASE = "https://starzmanga.com";
const XSANO_BASE = "https://www.xsano-manga.com";
const MANGALIK_BASE = "https://mangalik.net";
const AZORA_BASE = "https://azorafly.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const sourceSchemaReady = new WeakMap();

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
        { id: "xsano", name: "XSano Manga", mode: "blogger" },
        { id: "mangalik", name: "MangaLik", mode: "madara" },
        { id: "azora", name: "Azora", mode: "html" },
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

    if (action === "status") {
      const sources = ["mangatime", "teamx", "3asq", "starzmanga", "xsano", "mangalik", "azora"];
      const cutoffIso = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const [syncRows, releaseRows] = await Promise.all([
        db.prepare("SELECT source, last_started_at FROM source_sync_state").all(),
        db.prepare(`SELECT
            i.source AS source,
            MAX(c.published_at) AS last_published_at,
            SUM(CASE WHEN c.published_at > ? THEN 1 ELSE 0 END) AS recent_count
          FROM source_items i
          LEFT JOIN source_chapter_seen c ON c.source_key = i.source_key
          GROUP BY i.source`)
          .bind(cutoffIso)
          .all(),
      ]);

      const syncMap = new Map(
        (syncRows.results ?? []).map((row) => [String(row.source), Number(row.last_started_at ?? 0)]),
      );
      const releaseMap = new Map(
        (releaseRows.results ?? []).map((row) => [String(row.source), row]),
      );

      return json({
        sources: sources.map((source) => {
          const release = releaseMap.get(source);
          return {
            source,
            lastSyncAt: syncMap.get(source) || null,
            lastVerifiedReleaseAt: release?.last_published_at ?? null,
            recent24h: Number(release?.recent_count ?? 0),
          };
        }),
      });
    }

    if (action === "recent") {
      const source = sourceFromQuery(url);
      const page = safePage(url.searchParams.get("page"));
      const payload = source === "mangatime"
        ? await mangaTimeLatest(context, db, page)
        : source === "teamx"
          ? await teamXLatest(context, db, page)
          : source === "3asq"
            ? await asqLatest(db, page)
            : source === "starzmanga"
              ? await starzLatest(db, page)
              : source === "xsano"
                ? await xsanoLatest(context, db, page)
                : source === "mangalik"
                  ? await mangalikLatest(db, page)
                  : await azoraLatest(db, page);
      return json(payload, 200, shortCache());
    }

    if (action === "latest") {
      const source = sourceFromQuery(url);
      const page = safePage(url.searchParams.get("page"));
      const payload = source === "mangatime"
        ? await mangaTimeList(db, { page, sortBy: "recent" })
        : source === "teamx"
          ? await teamXCatalogLatest(db, page)
          : source === "3asq"
            ? await asqLatest(db, page)
            : source === "starzmanga"
              ? await starzList(db, { page, order: "latest" })
              : source === "xsano"
                ? await xsanoCatalogLatest(db, page)
                : source === "mangalik"
                  ? await mangalikLatest(db, page)
                  : await azoraLatest(db, page);
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
            : source === "starzmanga"
              ? await starzPopular(db, page)
              : source === "xsano"
                ? await xsanoPopular(db, page)
                : source === "mangalik"
                  ? await mangalikPopular(db, page)
                  : await azoraPopular(db, page);
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
            : source === "starzmanga"
              ? await starzSearch(db, query, page)
              : source === "xsano"
                ? await xsanoSearch(db, query, page)
                : source === "mangalik"
                  ? await mangalikSearch(db, query, page)
                  : await azoraSearch(db, query, page);
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
            : item.source === "starzmanga"
              ? await starzSeries(db, item)
              : item.source === "xsano"
                ? await xsanoSeries(db, item)
                : item.source === "mangalik"
                  ? await mangalikSeries(db, item)
                  : await azoraSeries(db, item);
      const observedDetail = await rememberChapterAvailability(db, detail);
      return json({ item: observedDetail }, 200, shortCache());
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
            : item.source === "starzmanga"
              ? await starzChapter(db, item, number)
              : item.source === "xsano"
                ? await xsanoChapter(db, item, number)
                : item.source === "mangalik"
                  ? await mangalikChapter(db, item, number)
                  : await azoraChapter(db, item, number);
      return json({ chapter }, 200, { "Cache-Control": "private, max-age=30" });
    }

    if (action === "image") {
      const source = sourceFromQuery(url);
      const raw = String(url.searchParams.get("url") ?? "");
      const referer = String(url.searchParams.get("referer") ?? "");
      return proxyImage(source, raw, referer);
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
  if (source !== "mangatime" && source !== "teamx" && source !== "3asq" && source !== "starzmanga" && source !== "xsano" && source !== "mangalik" && source !== "azora") {
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
  return /^(mt|tx|aq|sz|xs|ml|az):[A-Za-z0-9_-]{1,110}$/.test(key) ? key : "";
}

function shortCache() {
  return { "Cache-Control": "private, max-age=45" };
}

async function ensureSourceSchema(db) {
  let pending = sourceSchemaReady.get(db);
  if (!pending) {
    pending = (async () => {
      try {
        await Promise.all([
          db.prepare("SELECT first_seen_at FROM source_items LIMIT 1").first(),
          db.prepare("SELECT is_baseline FROM source_chapter_seen LIMIT 1").first(),
          db.prepare("SELECT last_started_at FROM source_sync_state LIMIT 1").first(),
        ]);
        return;
      } catch {
        // Missing tables/columns are repaired below once per binding.
      }

      await db
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
          first_seen_at INTEGER,
          UNIQUE(source, source_id)
        )`)
        .run();

      const columns = await db.prepare("PRAGMA table_info(source_items)").all();
      if (!(columns.results ?? []).some((column) => column.name === "first_seen_at")) {
        await db.prepare("ALTER TABLE source_items ADD COLUMN first_seen_at INTEGER").run();
      }

      const missingFirstSeen = await db
        .prepare("SELECT 1 AS present FROM source_items WHERE first_seen_at IS NULL LIMIT 1")
        .first();
      if (missingFirstSeen) {
        await db
          .prepare("UPDATE source_items SET first_seen_at = updated_at WHERE first_seen_at IS NULL")
          .run();
      }

      await db
        .prepare(`CREATE TABLE IF NOT EXISTS source_chapter_seen (
          source_key TEXT NOT NULL,
          chapter_identity TEXT NOT NULL,
          chapter_number REAL,
          published_at TEXT,
          first_seen_at INTEGER NOT NULL,
          is_baseline INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (source_key, chapter_identity),
          FOREIGN KEY (source_key) REFERENCES source_items(source_key) ON DELETE CASCADE
        )`)
        .run();
      const chapterColumns = await db.prepare("PRAGMA table_info(source_chapter_seen)").all();
      if (!(chapterColumns.results ?? []).some((column) => column.name === "is_baseline")) {
        await db.prepare("ALTER TABLE source_chapter_seen ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0").run();
      }
      await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_source_chapter_seen_release ON source_chapter_seen(first_seen_at DESC, source_key)")
        .run();

      await db
        .prepare(`CREATE TABLE IF NOT EXISTS source_sync_state (
          source TEXT PRIMARY KEY,
          last_started_at INTEGER NOT NULL DEFAULT 0
        )`)
        .run();
    })().catch((error) => {
      sourceSchemaReady.delete(db);
      throw error;
    });
    sourceSchemaReady.set(db, pending);
  }
  await pending;
}

async function rememberItems(db, items) {
  if (!items.length) return;
  const now = Date.now();
  const statements = items.slice(0, 80).map((item) =>
    db
      .prepare(`INSERT INTO source_items
        (source_key, source, source_id, slug, type, url, title, cover_url, description, status, genres_json, updated_at, first_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          updated_at = excluded.updated_at,
          first_seen_at = COALESCE(source_items.first_seen_at, excluded.first_seen_at)
        WHERE source_items.source_id IS NOT excluded.source_id
           OR source_items.slug IS NOT excluded.slug
           OR source_items.type IS NOT excluded.type
           OR source_items.url IS NOT excluded.url
           OR source_items.title IS NOT excluded.title
           OR (excluded.cover_url <> '' AND source_items.cover_url IS NOT excluded.cover_url)
           OR (excluded.description IS NOT NULL AND source_items.description IS NOT excluded.description)
           OR (excluded.status IS NOT NULL AND source_items.status IS NOT excluded.status)
           OR (excluded.genres_json <> '[]' AND source_items.genres_json IS NOT excluded.genres_json)`)
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
        now,
      ),
  );
  await db.batch(statements);
}

function sourceChapterIdentity(chapter) {
  const number = Number(chapter?.number);
  if (Number.isFinite(number)) return String(number);
  return String(chapter?.title ?? "").trim().slice(0, 120);
}

async function rememberChapterAvailability(db, item) {
  const chapters = Array.isArray(item?.chapters) ? item.chapters : [];
  if (!item?.key || !chapters.length) return item;

  const recent = chapters
    .filter((chapter) => !chapter.synthetic)
    .sort((a, b) => Number(b.number ?? 0) - Number(a.number ?? 0))
    .slice(0, 240);
  if (!recent.length) return item;

  const anySeen = await db
    .prepare("SELECT 1 AS present FROM source_chapter_seen WHERE source_key = ? LIMIT 1")
    .bind(item.key)
    .first();
  const isBaseline = !anySeen;
  const now = Date.now();
  let firstSeenAt = now;
  if (isBaseline) {
    const sourceItem = await db
      .prepare("SELECT first_seen_at FROM source_items WHERE source_key = ? LIMIT 1")
      .bind(item.key)
      .first();
    firstSeenAt = Number(sourceItem?.first_seen_at ?? now);
  }

  const identities = recent.map(sourceChapterIdentity).filter(Boolean);
  const byIdentity = new Map();
  for (let index = 0; index < identities.length; index += 40) {
    const chunk = identities.slice(index, index + 40);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT chapter_identity, chapter_number, first_seen_at, published_at, is_baseline
        FROM source_chapter_seen
        WHERE source_key = ? AND chapter_identity IN (${placeholders})`)
      .bind(item.key, ...chunk)
      .all();
    for (const row of result.results ?? []) {
      byIdentity.set(String(row.chapter_identity), row);
    }
  }

  const writes = [];
  for (const chapter of recent) {
    const identity = sourceChapterIdentity(chapter);
    if (!identity) continue;
    const chapterNumber = Number.isFinite(Number(chapter.number))
      ? Number(chapter.number)
      : null;
    const publishedAt = chapter.publishedAt ? String(chapter.publishedAt) : null;
    const existing = byIdentity.get(identity);

    if (!existing) {
      writes.push(
        db.prepare(`INSERT INTO source_chapter_seen
          (source_key, chapter_identity, chapter_number, published_at, first_seen_at, is_baseline)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(
            item.key,
            identity,
            chapterNumber,
            publishedAt,
            firstSeenAt,
            isBaseline ? 1 : 0,
          ),
      );
      byIdentity.set(identity, {
        chapter_identity: identity,
        chapter_number: chapterNumber,
        published_at: publishedAt,
        first_seen_at: firstSeenAt,
        is_baseline: isBaseline ? 1 : 0,
      });
      continue;
    }

    const storedNumber =
      existing.chapter_number == null ? null : Number(existing.chapter_number);
    const numberChanged = storedNumber !== chapterNumber;
    const publicationChanged =
      publishedAt != null && String(existing.published_at ?? "") !== publishedAt;
    if (!numberChanged && !publicationChanged) continue;

    writes.push(
      db.prepare(`UPDATE source_chapter_seen
        SET chapter_number = ?,
            published_at = COALESCE(?, published_at)
        WHERE source_key = ? AND chapter_identity = ?`)
        .bind(chapterNumber, publishedAt, item.key, identity),
    );
    byIdentity.set(identity, {
      ...existing,
      chapter_number: chapterNumber,
      published_at: publishedAt ?? existing.published_at ?? null,
    });
  }

  for (let index = 0; index < writes.length; index += 50) {
    await db.batch(writes.slice(index, index + 50));
  }

  return {
    ...item,
    chapters: chapters.map((chapter) => {
      const row = byIdentity.get(sourceChapterIdentity(chapter));
      return row
        ? {
            ...chapter,
            publishedAt: chapter.publishedAt ?? row.published_at ?? null,
            firstSeenAt: Number(row.first_seen_at),
            baselineObserved: Number(row.is_baseline ?? 0) === 1,
          }
        : chapter;
    }),
  };
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

async function recentVerifiedReleasesFromDb(db, source, cutoffIso) {
  const result = await db
    .prepare(`SELECT
        i.source_key,
        i.source,
        i.source_id,
        i.slug,
        i.type,
        i.url,
        i.title,
        i.cover_url,
        i.description,
        i.status,
        i.genres_json,
        c.chapter_number,
        c.published_at
      FROM source_chapter_seen c
      JOIN source_items i ON i.source_key = c.source_key
      WHERE i.source = ?
        AND c.published_at IS NOT NULL
        AND c.published_at > ?
      ORDER BY c.published_at DESC
      LIMIT 180`)
    .bind(source, cutoffIso)
    .all();

  const byKey = new Map();
  for (const row of result.results ?? []) {
    const number = Number(row.chapter_number);
    const publishedAt = String(row.published_at ?? "");
    if (!Number.isFinite(number) || !Number.isFinite(Date.parse(publishedAt))) continue;

    let item = byKey.get(row.source_key);
    if (!item) {
      item = {
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
        latest: number,
        chapters: [],
      };
      byKey.set(row.source_key, item);
    }

    item.latest = Math.max(Number(item.latest || 0), number);
    item.chapters.push({
      number,
      title: `الفصل ${number}`,
      publishedAt,
    });
  }

  return [...byKey.values()];
}

async function rememberRecentVerifiedChapters(db, item, now = Date.now()) {
  if (!item?.key || !Array.isArray(item.chapters)) return;

  // The public feed itself is capped at five chapters per work. Keep only a
  // 48-hour safety window in D1 so background refreshes stay cheap.
  const retentionCutoff = now - 48 * 60 * 60_000;
  const chapters = item.chapters
    .filter((chapter) => {
      if (chapter?.synthetic || !chapter?.publishedAt) return false;
      const timestamp = Date.parse(String(chapter.publishedAt));
      return Number.isFinite(timestamp) && timestamp > retentionCutoff;
    })
    .sort((a, b) => Date.parse(String(b.publishedAt)) - Date.parse(String(a.publishedAt)))
    .slice(0, 5);

  if (!chapters.length) return;

  const identities = chapters.map(sourceChapterIdentity).filter(Boolean);
  const placeholders = identities.map(() => "?").join(",");
  const existingResult = await db
    .prepare(`SELECT chapter_identity, chapter_number, published_at
      FROM source_chapter_seen
      WHERE source_key = ? AND chapter_identity IN (${placeholders})`)
    .bind(item.key, ...identities)
    .all();
  const existing = new Map(
    (existingResult.results ?? []).map((row) => [String(row.chapter_identity), row]),
  );

  const writes = [];
  for (const chapter of chapters) {
    const identity = sourceChapterIdentity(chapter);
    if (!identity) continue;

    const number = Number(chapter.number);
    const chapterNumber = Number.isFinite(number) ? number : null;
    const publishedAt = String(chapter.publishedAt);
    const row = existing.get(identity);

    if (row &&
        Number(row.chapter_number) === chapterNumber &&
        String(row.published_at ?? "") === publishedAt) {
      continue;
    }

    writes.push(
      db.prepare(`INSERT INTO source_chapter_seen
        (source_key, chapter_identity, chapter_number, published_at, first_seen_at, is_baseline)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(source_key, chapter_identity) DO UPDATE SET
          chapter_number = excluded.chapter_number,
          published_at = COALESCE(excluded.published_at, source_chapter_seen.published_at)`)
        .bind(item.key, identity, chapterNumber, publishedAt, now),
    );
  }

  if (writes.length) await db.batch(writes);
}

const PRIORITY_WORKS = {
  eleceed: {
    aliases: ["Eleceed"],
    mangatimeQueries: ["Eleceed"],
  },
  magicEmperor: {
    aliases: ["Magic Emperor", "Demonic Emperor", "إمبراطور السحر"],
    mangatimeQueries: ["Magic Emperor", "Demonic Emperor"],
    teamxSlug: "demonic-emperor",
  },
};

function priorityWindow(now = Date.now()) {
  // Saudi Arabia is UTC+3 year-round.
  const date = new Date(now + 3 * 60 * 60_000);
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const hour = date.getUTCHours();

  return {
    eleceed: day === 2 && hour >= 19 && hour <= 23,
    magicEmperor: (day === 5 || day === 6 || day === 0) && hour >= 4 && hour <= 7,
  };
}

function priorityRefreshActive(now = Date.now()) {
  const window = priorityWindow(now);
  return window.eleceed || window.magicEmperor;
}

function sourceRefreshIntervalMs(now = Date.now()) {
  // Protect D1 and upstream sources: priority windows are responsive without
  // turning every page visit into a frequent cache refresh.
  return priorityRefreshActive(now) ? 5 * 60_000 : 15 * 60_000;
}

// MangaTime -----------------------------------------------------------------

async function mangaTimeLatest(context, db, page) {
  if (page > 1) return { items: [], hasMore: false, page };

  const now = Date.now();
  const cutoffIso = new Date(now - 24 * 60 * 60_000).toISOString();
  const cached = await recentVerifiedReleasesFromDb(db, "mangatime", cutoffIso);

  const state = await db
    .prepare("SELECT last_started_at FROM source_sync_state WHERE source = 'mangatime' LIMIT 1")
    .first();
  const lastStartedAt = Number(state?.last_started_at ?? 0);

  if (now - lastStartedAt >= sourceRefreshIntervalMs(now)) {
    await db
      .prepare(`INSERT INTO source_sync_state (source, last_started_at)
        VALUES ('mangatime', ?)
        ON CONFLICT(source) DO UPDATE SET last_started_at = excluded.last_started_at`)
      .bind(now)
      .run();

    context.waitUntil(
      syncMangaTimeLatest(db).catch((error) => {
        console.error("MangaTime background sync failed", error);
      }),
    );
  }

  return { items: cached, hasMore: false, page };
}

async function syncMangaTimeLatest(db) {
  const result = await mangaTimeTrpc(
    "search.searchSeries",
    mangaTimeSearchInput({ page: 1, sortBy: "recent", query: null }),
  );

  const priorityRows = [];
  const activePriority = priorityWindow();
  const priorityQueries = [
    ...(activePriority.eleceed ? PRIORITY_WORKS.eleceed.mangatimeQueries : []),
    ...(activePriority.magicEmperor ? PRIORITY_WORKS.magicEmperor.mangatimeQueries : []),
  ];
  if (priorityQueries.length) {
    for (const query of priorityQueries) {
      try {
        const priorityResult = await mangaTimeTrpc(
          "search.searchSeries",
          mangaTimeSearchInput({ page: 1, sortBy: "recent", query }),
        );
        const row = (priorityResult?.results ?? [])[0];
        if (row && !priorityRows.some((entry) => String(entry.id) === String(row.id))) {
          priorityRows.push(row);
        }
      } catch (error) {
        console.warn("MangaTime priority search skipped", query, error);
      }
    }
  }

  const items = await Promise.all(
    [...priorityRows, ...(result?.results ?? [])]
      .filter((row, index, rows) =>
        rows.findIndex((entry) => String(entry.id) === String(row.id)) === index,
      )
      .slice(0, 26)
      .map(async (row) => ({
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

  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      const item = items[index];

      try {
        const chapterPayload = await mangaTimeTrpc("content.getChapters", {
          seriesId: item.sourceId,
          limit: 12,
        });
        const chapters = mangaTimeChaptersFromPayload(chapterPayload);
        await rememberRecentVerifiedChapters(db, { ...item, chapters });
      } catch (error) {
        console.warn("MangaTime recent sync skipped", item.key, error);
      }
    }
  });

  await Promise.all(workers);
}

function mangaTimeChaptersFromPayload(chapterPayload) {
  return (chapterPayload?.chapters ?? [])
    .map((chapter) => ({
      number: Number(chapter.number),
      title: String(chapter.title ?? `الفصل ${chapter.number}`),
      publishedAt: chapter.publishedAt ?? null,
    }))
    .filter((chapter) => Number.isFinite(chapter.number))
    .sort((a, b) => b.number - a.number);
}

async function mangaTimeList(db, { page, sortBy, query = null }) {
  const result = await mangaTimeTrpc(
    "search.searchSeries",
    mangaTimeSearchInput({ page, sortBy, query }),
  );
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

function mangaTimeSearchInput({ page, sortBy, query = null }) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  return {
    page,
    limit: 24,
    sortBy,
    sortOrder: "desc",
    ...(normalizedQuery ? { query: normalizedQuery } : {}),
  };
}

async function mangaTimeSeries(db, item) {
  const [detail, chapterPayload] = await Promise.all([
    mangaTimeTrpc("content.getSeriesBySlug", { slug: item.slug }),
    mangaTimeTrpc("content.getChapters", { seriesId: item.sourceId, limit: -1 }),
  ]);

  const chapters = mangaTimeChaptersFromPayload(chapterPayload);

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

function mangaTimeChapterUrl(item, number) {
  const type = String(item?.type || "manhwa").trim().replace(/^\/+|\/+$/g, "") || "manhwa";
  const slug = encodeURIComponent(String(item?.slug || "").trim());
  return `${MANGATIME_BASE}/${encodeURIComponent(type)}/${slug}/chapter/${encodeURIComponent(String(number))}`;
}

function isMangaTimeUiImage(url) {
  return /(?:logo|favicon|avatar|profile|banner|icon|emoji|badge|placeholder|cover)(?:[\/_-]|\.)/i.test(String(url));
}

function parseMangaTimePages(html) {
  const source = String(html ?? "");
  if (!source) return [];

  const markers = [
    /id=["'][^"']*(?:reader|chapter)[^"']*["']/i,
    /class=["'][^"']*(?:reader|chapter-(?:content|pages|images)|reading-content)[^"']*["']/i,
  ];
  let scoped = source;
  for (const marker of markers) {
    const index = source.search(marker);
    if (index >= 0) {
      scoped = source.slice(index);
      break;
    }
  }

  const footer = scoped.search(/(?:<footer\b|id=["']comments["']|class=["'][^"']*recommend)/i);
  if (footer >= 0) scoped = scoped.slice(0, footer);

  const imagePages = extractImages(scoped)
    .map((image) => absoluteUrl(MANGATIME_BASE, image.src))
    .filter((url) => {
      if (!url || isMangaTimeUiImage(url)) return false;
      try {
        const parsed = new URL(url);
        return /\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(parsed.pathname + parsed.search);
      } catch {
        return false;
      }
    });
  if (imagePages.length >= 2) return [...new Set(imagePages)];

  const normalized = scoped
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const inline = [];
  const urlRegex = /https?:\/\/[^"'<>\s\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\s\\]*)?/gi;
  let match;
  while ((match = urlRegex.exec(normalized))) {
    const url = absoluteUrl(MANGATIME_BASE, match[0]);
    if (url && !isMangaTimeUiImage(url)) inline.push(url);
  }

  return [...new Set([...imagePages, ...inline])];
}

async function mangaTimeFetchChapterHtml(item, number) {
  const urls = [
    mangaTimeChapterUrl(item, number),
    `${MANGATIME_BASE}/manga/${encodeURIComponent(String(item?.slug || ""))}/chapter-${encodeURIComponent(String(number))}/`,
  ];

  let lastError = null;
  for (const target of urls) {
    try {
      const response = await fetch(target, {
        headers: sourceHeaders(
          MANGATIME_BASE,
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
        redirect: "follow",
        cf: { cacheTtl: 20, cacheEverything: true },
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      const pages = parseMangaTimePages(html);
      if (pages.length) return { pages, url: response.url || target };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn("MangaTime HTML reader fallback failed", {
      key: item?.key,
      chapter: number,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
  return { pages: [], url: mangaTimeChapterUrl(item, number) };
}

function mangaTimePagesFromPayload(payload) {
  const candidates = [
    payload?.pages,
    payload?.images,
    payload?.pageUrls,
    payload?.chapterPages,
    payload?.data?.pages,
    payload?.chapter?.pages,
  ].find(Array.isArray) ?? [];

  return [...new Set(
    candidates
      .map((page) => {
        if (typeof page === "string") return page;
        if (!page || typeof page !== "object") return "";
        return page.url ?? page.src ?? page.imageUrl ?? page.image_url ?? page.path ?? "";
      })
      .map((page) => absoluteUrl(MANGATIME_BASE, page))
      .filter(Boolean),
  )];
}

async function mangaTimeChapterPages(item, number) {
  let primaryPayload = null;
  let primaryError = null;

  try {
    primaryPayload = await mangaTimeTrpc("content.getChapterPages", {
      seriesSlug: item.slug,
      chapterNumber: number,
    });
    if (primaryPayload?.isUnlocked === false || primaryPayload?.locked === true) {
      throw new SourceError("CHAPTER_LOCKED", "هذا الفصل مقفل في المصدر.", 423);
    }
    const primaryPages = mangaTimePagesFromPayload(primaryPayload);
    if (primaryPages.length) return { payload: primaryPayload, pages: primaryPages };
  } catch (error) {
    if (error instanceof SourceError && error.code === "CHAPTER_LOCKED") throw error;
    primaryError = error;
  }

  // MangaTime has changed the reader payload shape before. Resolve the exact
  // chapter id only when the normal reader call fails, then try the source's
  // id-based input shapes without slowing down healthy reads.
  try {
    const chapterPayload = await mangaTimeTrpc("content.getChapters", {
      seriesId: item.sourceId,
      limit: -1,
    });
    const chapter = (chapterPayload?.chapters ?? []).find(
      (entry) => Math.abs(Number(entry?.number) - Number(number)) < 0.000001,
    );
    const chapterId = chapter?.id ?? chapter?.chapterId ?? null;
    const fallbackInputs = [
      chapterId ? { chapterId } : null,
      chapterId ? { id: chapterId } : null,
      { seriesId: item.sourceId, chapterNumber: number },
    ].filter(Boolean);

    for (const input of fallbackInputs) {
      try {
        const payload = await mangaTimeTrpc("content.getChapterPages", input);
        if (payload?.isUnlocked === false || payload?.locked === true) continue;
        const pages = mangaTimePagesFromPayload(payload);
        if (pages.length) return { payload, pages };
      } catch {
        // Try the next compatibility shape.
      }
    }
  } catch {
    // Keep the original reader failure below. Chapter-list refresh is only a
    // compatibility fallback and must not hide the useful source error.
  }

  const htmlFallback = await mangaTimeFetchChapterHtml(item, number);
  if (htmlFallback.pages.length) {
    return {
      payload: {
        id: null,
        seriesId: item.sourceId,
        readerUrl: htmlFallback.url,
      },
      pages: htmlFallback.pages,
    };
  }

  if (primaryError instanceof SourceError) throw primaryError;
  throw new SourceError("NO_PAGES", "MangaTime لم يرجع صور الفصل.", 502);
}

async function mangaTimeChapter(context, db, item, number) {
  if (!Number.isFinite(number) || number < 0) {
    throw new SourceError("UNSUPPORTED_CHAPTER", "رقم الفصل غير صالح.", 400);
  }

  const { payload: result, pages } = await mangaTimeChapterPages(item, number);

  // The pages endpoint is the critical path. Series metadata/chapter-list
  // refresh is useful for navigation, but it must never make an otherwise
  // readable chapter fail. Fall back to the D1-cached item when MangaTime's
  // secondary metadata endpoints are temporarily unavailable.
  let series = item;
  try {
    series = await mangaTimeSeries(db, item);
  } catch (error) {
    console.warn("MangaTime chapter metadata refresh failed; using cached item", {
      key: item.key,
      chapter: number,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const navigation = chapterNavigation(series.chapters ?? [], number);
  if (result?.seriesId && result?.id) {
    context.waitUntil?.(
      mangaTimeTrackView(String(result.seriesId), String(result.id)).catch(() => undefined),
    );
  }

  return {
    item: series,
    number,
    title:
      series.chapters?.find(
        (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
      )?.title ?? `الفصل ${number}`,
    pages,
    ...navigation,
  };
}

async function mangaTimeTrpc(endpoint, input) {
  const headers = sourceHeaders(MANGATIME_BASE, "application/json,text/plain,*/*");
  const cache = { cacheTtl: endpoint.startsWith("search.") ? 45 : 20, cacheEverything: true };
  const attempts = [
    {
      batched: false,
      url: (() => {
        const value = new URL(`${MANGATIME_BASE}/api/trpc/${endpoint}`);
        value.searchParams.set("input", JSON.stringify({ json: input }));
        return value;
      })(),
    },
    {
      batched: true,
      url: (() => {
        const value = new URL(`${MANGATIME_BASE}/api/trpc/${endpoint}`);
        value.searchParams.set("batch", "1");
        value.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
        return value;
      })(),
    },
  ];

  let lastStatus = 502;
  let lastMessage = "";

  for (const attempt of attempts) {
    let response;
    try {
      response = await fetch(attempt.url, {
        headers,
        redirect: "follow",
        cf: cache,
      });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      continue;
    }

    lastStatus = response.status;
    if (!response.ok) {
      lastMessage = `HTTP ${response.status}`;
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      lastMessage = "MangaTime رجع استجابة غير صالحة.";
      continue;
    }

    const envelope = attempt.batched
      ? (Array.isArray(payload) ? payload[0] : null)
      : (Array.isArray(payload) ? payload[0] : payload);
    if (envelope?.error) {
      lastMessage =
        envelope.error?.json?.message ||
        envelope.error?.message ||
        "MangaTime API error";
      continue;
    }

    const data = envelope?.result?.data?.json;
    if (data !== undefined) return data;
    lastMessage = "MangaTime API رجع استجابة فارغة.";
  }

  const detail = lastMessage ? ` (${lastMessage})` : "";
  throw new SourceError(
    "MANGATIME_UPSTREAM",
    `تعذر الوصول إلى MangaTime الآن${detail}`,
    lastStatus >= 400 && lastStatus < 600 ? 502 : 502,
  );
}

async function mangaTimeTrackView(seriesId, chapterId) {
  const url = new URL(`${MANGATIME_BASE}/api/trpc/content.trackView`);
  url.searchParams.set("batch", "1");
  await fetch(url, {
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

async function teamXCatalogLatest(db, page) {
  if (page > 1) {
    // Team-X does not expose a dedicated paginated "latest" API. Its series
    // catalogue is still useful for Discover continuation pages.
    return teamXPopular(db, page);
  }

  const html = await teamXFetchText("/");
  const scoped = teamXLatestSection(html);
  const items = await teamXItemsFromHtml(scoped);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: false, page };
}

async function teamXLatest(context, db, page) {
  if (page > 1) return { items: [], hasMore: false, page };

  const now = Date.now();
  const cutoffIso = new Date(now - 24 * 60 * 60_000).toISOString();

  // Serve only verified timestamps already cached in D1. This keeps the user
  // request fast and independent from Team-X series-page latency.
  const cached = await recentVerifiedReleasesFromDb(db, "teamx", cutoffIso);

  // Refresh Team-X in the background at most once every five minutes. The
  // current request never waits for the N series-page checks.
  if (page === 1) {
    const state = await db
      .prepare("SELECT last_started_at FROM source_sync_state WHERE source = 'teamx' LIMIT 1")
      .first();
    const lastStartedAt = Number(state?.last_started_at ?? 0);
    if (now - lastStartedAt >= sourceRefreshIntervalMs(now)) {
      await db
        .prepare(`INSERT INTO source_sync_state (source, last_started_at)
          VALUES ('teamx', ?)
          ON CONFLICT(source) DO UPDATE SET last_started_at = excluded.last_started_at`)
        .bind(now)
        .run();

      context.waitUntil(
        syncTeamXLatest(db).catch((error) => {
          console.error("Team-X background sync failed", error);
        }),
      );
    }
  }

  return { items: cached, hasMore: false, page };
}


function teamXLatestSection(html) {
  const source = String(html ?? "");
  const latestMarker = source.search(/(?:اخر|آخر)\s+الفصول/i);
  if (latestMarker >= 0) return source.slice(latestMarker);

  const postBodyMarker = source.search(/class=["'][^"']*post-body[^"']*["']/i);
  return postBodyMarker >= 0 ? source.slice(postBodyMarker) : source;
}

async function syncTeamXLatest(db) {
  const html = await teamXFetchText("/");
  // Scope strictly to Team-X's "آخر الفصول" section. The homepage also has
  // popular-series cards before it; including those can consume the bounded
  // sync slots and make genuinely recent releases disappear from Wany.
  const scoped = teamXLatestSection(html);
  const parsedItems = (await teamXItemsFromHtml(scoped)).slice(0, 30);
  const priorityItem = {
    key: "tx:" + safeSlugKey(PRIORITY_WORKS.magicEmperor.teamxSlug),
    source: "teamx",
    sourceId: PRIORITY_WORKS.magicEmperor.teamxSlug,
    slug: PRIORITY_WORKS.magicEmperor.teamxSlug,
    type: "series",
    url: TEAMX_BASE + "/series/" + encodeURIComponent(PRIORITY_WORKS.magicEmperor.teamxSlug),
    title: "Demonic Emperor",
    cover: "",
    description: "",
    status: "",
    genres: [],
  };
  const baseItems = priorityWindow().magicEmperor
    ? [priorityItem, ...parsedItems.filter((item) => item.key !== priorityItem.key)].slice(0, 30)
    : parsedItems;

  // Small bounded concurrency avoids hammering Team-X while still finishing
  // quickly enough for the next Wany refresh to pick up the cached releases.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, baseItems.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= baseItems.length) break;
      const item = baseItems[index];

      try {
        const detailHtml = await teamXFetchText(item.url, false);
        const chapters = parseTeamXChapters(detailHtml, item.url)
          .filter((chapter) => !chapter.synthetic && Boolean(chapter.publishedAt));
        if (!chapters.length) continue;

        const detail = {
          ...item,
          latest: chapters[0]?.number ?? null,
          chapters,
        };
        await rememberItems(db, [detail]);
        await rememberRecentVerifiedChapters(db, detail);
      } catch (error) {
        console.warn("Team-X series sync skipped", item.key, error);
      }
    }
  });

  await Promise.all(workers);
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

function parseTeamXPublishedAt(block, now = Date.now()) {
  const text = cleanText(stripTags(block));
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\bjust now\b/.test(normalized)) return new Date(now - 30_000).toISOString();

  const numeric = normalized.match(/\b(\d+)\s*(minute|minutes|hour|hours)\s+ago\b/i);
  if (numeric) {
    const amount = Number(numeric[1]);
    const unit = numeric[2].toLowerCase();
    const milliseconds = unit.startsWith("minute") ? 60_000 : 3_600_000;
    return new Date(now - amount * milliseconds).toISOString();
  }

  if (/\ba minute ago\b/.test(normalized)) return new Date(now - 60_000).toISOString();
  if (/\ban? hour ago\b/.test(normalized)) return new Date(now - 3_600_000).toISOString();

  // Day/week/month labels are too coarse for Wany's strict 24-hour feed.
  return null;
}

function parseTeamXChapters(html, seriesUrl, now = Date.now()) {
  const source = String(html ?? "");
  const parsedBase = new URL(seriesUrl, TEAMX_BASE);
  const basePath = parsedBase.pathname.replace(/\/$/, "");
  const found = new Map();
  const anchors = [];
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(source))) {
    const attrs = parseAttrs(match[1]);
    const href = absoluteUrl(TEAMX_BASE, attrs.href);
    if (!href) continue;

    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.pathname === basePath || !parsed.pathname.startsWith(basePath + "/")) continue;

    const tail = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(tail)) continue;

    const number = Number(tail);
    if (!Number.isFinite(number)) continue;
    anchors.push({
      number,
      href,
      inner: match[2],
      start: match.index,
      end: regex.lastIndex,
    });
  }

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const nextStart = anchors[index + 1]?.start ?? source.length;
    const row = source.slice(anchor.start, Math.min(nextStart, anchor.end + 1400));
    const rawTitle = cleanText(stripTags(anchor.inner)) || `الفصل ${anchor.number}`;
    const title = rawTitle
      .replace(/\b(?:just now|(?:\d+|a|an)\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)\b/gi, "")
      .trim() || `الفصل ${anchor.number}`;

    found.set(anchor.number, {
      number: anchor.number,
      title,
      publishedAt: parseTeamXPublishedAt(row, now),
      url: anchor.href,
    });
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
            synthetic: true,
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
  // Use 3asq's manga archive ordered by latest. It exposes the series card,
  // chapter rows and source dates together, so no per-series hydration is needed.
  const path = page > 1
    ? "/manga/page/" + page + "/?m_orderby=latest"
    : "/manga/?m_orderby=latest";
  const html = await asqFetchText(path);

  const archiveItems = asqLatestItemsFromArchiveHtml(html);
  const direct = archiveItems.length ? archiveItems : asqLatestItemsFromHtml(html);

  if (direct.length) {
    await rememberItems(db, direct);
    return { items: direct.slice(0, 48), hasMore: asqHasNext(html), page };
  }

  // Fail closed for New: a title-only fallback cannot prove chapter timestamps.
  return { items: [], hasMore: asqHasNext(html), page };
}

function asqSafeSeriesTitle(value, fallback = "") {
  const title = cleanText(value);
  if (!title) return cleanText(fallback);
  if (/^AddText[_\s-]/i.test(title)) return cleanText(fallback);
  if (/^بدون\s*اسم\s*\d*$/i.test(title)) return cleanText(fallback);
  if (/^(?:الفصل|chapter)\s*\d+(?:\.\d+)?$/i.test(title)) return cleanText(fallback);
  return title;
}

function asqLatestItemIsSane(item) {
  if (!item || item.source !== "3asq" || !item.slug || !item.key) return false;
  const title = asqSafeSeriesTitle(item.title);
  if (!title) return false;
  const chapters = Array.isArray(item.chapters) ? item.chapters : [];
  return chapters.length > 0 && chapters.every((chapter) => {
    const number = Number(chapter?.number);
    const published = Date.parse(chapter?.publishedAt || "");
    if (!Number.isFinite(number) || !Number.isFinite(published)) return false;
    if (!chapter?.url || !/^https?:\/\//i.test(chapter.url)) return false;
    return true;
  });
}

function parseAsqLatestCardChapters(block, seriesUrl, now = Date.now()) {
  const source = String(block ?? "");
  const base = new URL(seriesUrl, ASQ_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const chapterRegex = /<a\b([^>]*href=["'][^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const chapters = [];
  let match;

  while ((match = chapterRegex.exec(source))) {
    const attrs = parseAttrs(match[1]);
    const url = absoluteUrl(ASQ_BASE, attrs.href);
    if (!url) continue;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (!parsed.pathname.startsWith(basePath + "/") || parsed.pathname === basePath + "/") continue;

    const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    const title = cleanText(stripTags(match[2])) || chapterId;
    const number = asqChapterNumber(title, chapterId);
    if (!Number.isFinite(number)) continue;

    chapters.push({
      number,
      title: title || "الفصل " + number,
      url,
      start: match.index,
      end: chapterRegex.lastIndex,
      publishedAt: null,
    });
  }

  if (!chapters.length) return [];

  // First preference: the date that lives inside the same structural <li>.
  // This is the strongest association and is what normal Madara chapter lists use.
  for (const chapter of chapters) {
    const liStart = source.lastIndexOf("<li", chapter.start);
    const liEnd = source.indexOf("</li>", chapter.end);
    if (liStart < 0 || liEnd < chapter.end) continue;
    const row = source.slice(liStart, liEnd + 5);
    const linksInRow = (row.match(/\/manga\//gi) || []).length;
    if (linksInRow > 2) continue;
    chapter.publishedAt = parseAsqRecentPublishedAt(row, now);
  }

  // Homepage/latest widgets sometimes place the date beside the chapter row
  // instead of inside <li>. Detect one consistent orientation for the card,
  // then pair each chapter only with the date in its own adjacent interval.
  const first = chapters[0];
  const secondStart = chapters[1]?.start ?? source.length;
  const firstAfter = parseAsqRecentPublishedAt(source.slice(first.end, secondStart), now);
  const firstBefore = parseAsqRecentPublishedAt(source.slice(0, first.start), now);
  const orientation = firstAfter ? "after" : firstBefore ? "before" : null;

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (chapter.publishedAt) continue;

    const previousEnd = chapters[index - 1]?.end ?? 0;
    const nextStart = chapters[index + 1]?.start ?? source.length;
    const interval = orientation === "before"
      ? source.slice(previousEnd, chapter.start)
      : orientation === "after"
        ? source.slice(chapter.end, nextStart)
        : "";

    chapter.publishedAt = interval ? parseAsqRecentPublishedAt(interval, now) : null;
  }

  return chapters
    .filter((chapter) => Boolean(chapter.publishedAt))
    .map(({ start: _start, end: _end, ...chapter }) => chapter);
}

function asqLatestItemsFromArchiveHtml(html, now = Date.now()) {
  const source = String(html ?? "");
  // Important: use page-item-detail alone. Combining it with its parent
  // c-tabs-item__content creates nested split boundaries and can cut a card
  // before its chapter rows.
  let blocks = madaraBlocksByClass(source, ["page-item-detail"]);
  if (!blocks.length) blocks = madaraBlocksByClass(source, ["c-tabs-item__content"]);

  const items = [];
  for (const block of blocks) {
    const item = asqItemsFromHtml(block)[0];
    if (!item) continue;

    const chapters = parseAsqLatestCardChapters(block, item.url, now);
    if (!chapters.length) continue;

    const candidate = {
      ...item,
      latest: Math.max(...chapters.map((chapter) => Number(chapter.number))),
      chapters,
    };
    if (asqLatestItemIsSane(candidate)) items.push(candidate);
  }

  const byKey = new Map();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing) {
      byKey.set(item.key, item);
      continue;
    }
    existing.chapters = [...existing.chapters, ...item.chapters]
      .filter((chapter, index, list) =>
        list.findIndex((candidate) => Number(candidate.number) === Number(chapter.number)) === index,
      )
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    existing.latest = Math.max(Number(existing.latest || 0), Number(item.latest || 0));
  }
  return [...byKey.values()];
}

function asqLatestItemsFromHtml(html) {
  const source = String(html ?? "");
  const bySlug = new Map();
  const chapterLink = /<a\b([^>]*href=["'][^"']*\/manga\/([^/"']+)\/([^/"']+)\/?[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = chapterLink.exec(source))) {
    const attrs = parseAttrs(match[1]);
    const href = absoluteUrl(ASQ_BASE, attrs.href);
    if (!href) continue;

    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (!/^(?:www\.)?3asq\.online$/i.test(parsed.hostname)) continue;

    const slug = decodeURIComponent(match[2]);
    const chapterId = decodeURIComponent(match[3]);
    const chapterTitle = cleanText(stripTags(match[4])) || chapterId;
    const number = asqChapterNumber(chapterTitle, chapterId);
    if (!slug || !Number.isFinite(number)) continue;

    // Keep the exact fast parser that worked before, but scope title/cover to
    // the surrounding series card instead of the nearest chapter <li>.
    const cardStart = Math.max(
      source.lastIndexOf('<div class="page-item-detail', match.index),
      source.lastIndexOf("<div class='page-item-detail", match.index),
      source.lastIndexOf('<div class="c-tabs-item__content', match.index),
      source.lastIndexOf("<div class='c-tabs-item__content", match.index),
    );
    const nextDetailDouble = source.indexOf('<div class="page-item-detail', chapterLink.lastIndex);
    const nextDetailSingle = source.indexOf("<div class='page-item-detail", chapterLink.lastIndex);
    const nextTabDouble = source.indexOf('<div class="c-tabs-item__content', chapterLink.lastIndex);
    const nextTabSingle = source.indexOf("<div class='c-tabs-item__content", chapterLink.lastIndex);
    const ends = [nextDetailDouble, nextDetailSingle, nextTabDouble, nextTabSingle]
      .filter((value) => value >= 0);
    const cardEnd = ends.length
      ? Math.min(...ends)
      : Math.min(source.length, chapterLink.lastIndex + 3500);
    const block = source.slice(
      cardStart >= 0 ? cardStart : Math.max(0, match.index - 1600),
      cardEnd,
    );

    const seriesUrl = ASQ_BASE + "/manga/" + encodeURIComponent(slug) + "/";
    const scopedChapters = parseAsqLatestCardChapters(block, seriesUrl);
    const scopedChapter = scopedChapters.find((chapter) =>
      Math.abs(Number(chapter.number) - number) < 0.000001 &&
      chapter.url === href,
    );
    const publishedAt = scopedChapter?.publishedAt ?? null;
    if (!publishedAt) continue;

    const seriesAnchor = extractAnchors(block).find((entry) => {
      const url = absoluteUrl(ASQ_BASE, entry.href);
      if (!url) return false;
      try {
        return new URL(url).pathname.replace(/\/$/, "") === "/manga/" + slug;
      } catch {
        return false;
      }
    });

    const seriesTitle = cleanText(
      seriesAnchor?.attrs?.title ||
      firstMatch(seriesAnchor?.inner || "", /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
      firstImgAttr(seriesAnchor?.inner || block, "alt") ||
      stripTags(seriesAnchor?.inner || ""),
    );
    const slugTitle = slug.replace(/[-_]+/g, " ");
    const title = asqSafeSeriesTitle(seriesTitle, slugTitle);
    const cover = absoluteUrl(ASQ_BASE, asqFirstImage(block));

    const key = "aq:" + safeSlugKey(slug);
    const existing = bySlug.get(slug) || {
      key,
      source: "3asq",
      sourceId: slug,
      slug,
      type: "manga",
      url: seriesUrl,
      title,
      cover,
      description: "",
      status: "",
      genres: [],
      latest: number,
      chapters: [],
    };

    existing.latest = Math.max(Number(existing.latest || number), number);
    existing.chapters.push({
      number,
      title: chapterTitle || "الفصل " + number,
      publishedAt,
      url: href,
    });
    if (!existing.cover && cover) existing.cover = cover;
    if ((!existing.title || existing.title === slug.replace(/[-_]+/g, " ")) && title) {
      existing.title = title;
    }
    bySlug.set(slug, existing);
  }

  return [...bySlug.values()]
    .map((item) => ({
      ...item,
      chapters: item.chapters
        .filter((chapter, index, list) =>
          list.findIndex((candidate) => Number(candidate.number) === Number(chapter.number)) === index,
        )
        .sort((a, b) => {
          const byDate = Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || "");
          return Number.isFinite(byDate) && byDate !== 0
            ? byDate
            : Number(b.number) - Number(a.number);
        }),
    }))
    // Fail closed: malformed latest metadata must disappear rather than be
    // advertised as a real release. Other Wany source features remain intact.
    .filter(asqLatestItemIsSane);
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

  const seriesUrl = item.url || ASQ_BASE + "/manga/" + item.slug + "/";
  let chapterHtml = html;
  let chapters = parseAsqChapters(chapterHtml, seriesUrl);

  // Current 3asq/Madara pages often omit chapter rows from the initial HTML.
  // Prefer the per-title AJAX chapter route because it does not depend on a post id.
  if (!chapters.length) {
    chapterHtml = await asqFetchSeriesChapters(seriesUrl).catch(() => html);
    chapters = parseAsqChapters(chapterHtml, seriesUrl);
  }

  // Older Madara layouts expose a post id and use WordPress admin-ajax instead.
  if (!chapters.length) {
    const postId = asqPostId(html);
    if (postId) {
      chapterHtml = await asqFetchChapters(postId, seriesUrl).catch(() => html);
      chapters = parseAsqChapters(chapterHtml, seriesUrl);
    }
  }

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
  if (/مانها|manhua/.test(type)) return "manhua";
  if (/مانجا\s*ويب|webtoon/.test(type)) return "webtoon";
  if (/مانجا|manga/.test(type)) return "manga";
  if (/كوميك|comic/.test(type)) return "comic";
  return type || "manga";
}

async function asqFetchSeriesChapters(seriesUrl) {
  const base = new URL(seriesUrl, ASQ_BASE);
  const chapterUrl = new URL(base.pathname.replace(/\/$/, "") + "/ajax/chapters/", base.origin);
  const response = await fetch(chapterUrl.toString(), {
    method: "POST",
    headers: {
      ...sourceHeaders(
        seriesUrl,
        "text/html,application/xhtml+xml,*/*;q=0.8",
      ),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: seriesUrl,
    },
    body: "",
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: false },
  });
  if (!response.ok) {
    throw new SourceError("ASQ_CHAPTERS", "العاشق لم يرجع قائمة الفصول.", 502);
  }
  return response.text();
}

function asqPostId(html) {
  return cleanText(
    firstMatch(html, /id=["']manga-chapters-holder["'][^>]*data-id=["']([^"']+)["']/i) ||
      firstMatch(html, /data-id=["']([^"']+)["'][^>]*id=["']manga-chapters-holder["']/i) ||
      firstMatch(html, /class=["'][^"']*rating-post-id[^"']*["'][^>]*value=["']([^"']+)["']/i) ||
      firstMatch(html, /value=["']([^"']+)["'][^>]*class=["'][^"']*rating-post-id/i) ||
      firstMatch(html, /data-post=["']([^"']+)["']/i),
  );
}

async function asqFetchChapters(postId, referer) {
  const body = new URLSearchParams({
    action: "manga_get_chapters",
    manga: String(postId),
  });
  const response = await fetch(ASQ_BASE + "/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: {
      ...sourceHeaders(
        referer || ASQ_BASE,
        "text/html,application/xhtml+xml,*/*;q=0.8",
      ),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer || ASQ_BASE,
    },
    body: body.toString(),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: false },
  });
  if (!response.ok) {
    throw new SourceError("ASQ_CHAPTERS", "العاشق لم يرجع قائمة الفصول.", 502);
  }
  return response.text();
}

function parseAsqPublishedAt(block, now = Date.now()) {
  const dateBlock =
    firstMatch(block, /<[^>]*class=["'][^"']*\bchapter-release-date\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ||
    firstMatch(block, /<[^>]*class=["'][^"']*\bpost-on\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const text = cleanText(stripTags(dateBlock));
  if (!text) return null;

  const normalized = text
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/،/g, ",")
    .trim();

  const relative = normalized.match(/منذ\s+(\d+)\s*(دقيقة|دقائق|ساعة|ساعات|يوم|أيام)/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const milliseconds =
      unit.startsWith("دقيق") ? 60_000 :
      unit.startsWith("ساع") ? 3_600_000 :
      86_400_000;
    return new Date(now - amount * milliseconds).toISOString();
  }
  if (/منذ\s+دقيقة/i.test(normalized)) return new Date(now - 60_000).toISOString();
  if (/منذ\s+ساعتين/i.test(normalized)) return new Date(now - 2 * 3_600_000).toISOString();
  if (/منذ\s+ساعة/i.test(normalized)) return new Date(now - 3_600_000).toISOString();
  if (/منذ\s+يومين/i.test(normalized)) return new Date(now - 2 * 86_400_000).toISOString();
  if (/منذ\s+يوم(?:\s+واحد)?/i.test(normalized)) return new Date(now - 86_400_000).toISOString();

  const months = {
    يناير: 0, فبراير: 1, مارس: 2, أبريل: 3, ابريل: 3, مايو: 4, يونيو: 5,
    يوليو: 6, أغسطس: 7, اغسطس: 7, سبتمبر: 8, أكتوبر: 9, اكتوبر: 9,
    نوفمبر: 10, ديسمبر: 11,
  };
  const absolute = normalized.match(/(\d{1,2})\s+([\u0600-\u06ff]+)[,\s]+(\d{4})/);
  if (!absolute) return null;
  const month = months[absolute[2]];
  if (month == null) return null;
  const timestamp = Date.UTC(Number(absolute[3]), month, Number(absolute[1]));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseAsqRecentPublishedAt(block, now = Date.now()) {
  const raw =
    firstMatch(block, /<[^>]*class=["'][^"']*\bchapter-release-date\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ||
    firstMatch(block, /<[^>]*class=["'][^"']*\bpost-on\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const text = cleanText(stripTags(raw));
  if (!text) return null;

  // "منذ يوم/يومين" is intentionally too coarse for a strict 24-hour feed:
  // "منذ يوم" can represent anything around/over the boundary. Fail closed.
  if (/منذ\s+(?:يوم|يومين|\d+\s*(?:يوم|أيام))/i.test(text)) return null;
  return parseAsqPublishedAt(block, now);
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
      publishedAt: parseAsqPublishedAt(block),
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
  const html = await starzFetchText(
    "/manga/page/" + page + "/?m_orderby=latest",
  );
  const items = starzLatestItemsFromHtml(html);

  if (items.length) {
    await rememberItems(db, items);
    return { items: items.slice(0, 48), hasMore: starzHasNext(html), page };
  }

  return { items: [], hasMore: starzHasNext(html), page };
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

function parseStarzPublishedAt(block, now = Date.now()) {
  const source = String(block ?? "");

  const machine =
    firstMatch(source, /\bdatetime=["']([^"']+)["']/i) ||
    firstMatch(source, /\bdata-(?:time|datetime|published)=["']([^"']+)["']/i);
  if (machine) {
    const parsed = Date.parse(machine);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  const timestamp = firstMatch(source, /\bdata-timestamp=["'](\d{10,13})["']/i);
  if (timestamp) {
    const raw = Number(timestamp);
    const parsed = timestamp.length === 10 ? raw * 1000 : raw;
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  const text = cleanText(stripTags(source))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  if (/(?:منذ\s*)?(?:دقيقة واحدة|دقيقة)\b/i.test(text)) {
    return new Date(now - 60_000).toISOString();
  }
  if (/(?:منذ\s*)?دقيقتين\b/i.test(text)) {
    return new Date(now - 2 * 60_000).toISOString();
  }

  let relative = text.match(/(?:منذ\s*)?(\d+)\s*(?:دقيقة|دقائق|minute|minutes)\s*(?:ago)?/i);
  if (relative) return new Date(now - Number(relative[1]) * 60_000).toISOString();

  if (/(?:منذ\s*)?(?:ساعة واحدة|ساعة)\b/i.test(text)) {
    return new Date(now - 3_600_000).toISOString();
  }
  if (/(?:منذ\s*)?ساعتين\b/i.test(text)) {
    return new Date(now - 2 * 3_600_000).toISOString();
  }

  relative = text.match(/(?:منذ\s*)?(\d+)\s*(?:ساعة|ساعات|hour|hours)\s*(?:ago)?/i);
  if (relative) return new Date(now - Number(relative[1]) * 3_600_000).toISOString();

  // Starz often exposes calendar dates without a time. Those are useful on
  // series pages, but not precise enough for Wany's strict <24h feed.
  return null;
}

function parseStarzChapters(html, seriesUrl, now = Date.now()) {
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
    found.set(number, {
      number,
      title: title || "الفصل " + number,
      publishedAt: parseStarzPublishedAt(block, now),
      url,
    });
  }
  return [...found.values()].sort((a, b) => b.number - a.number);
}

function parseStarzLatestCardChapters(block, seriesUrl, now = Date.now()) {
  const base = new URL(seriesUrl, STARZ_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const anchors = extractAnchors(block)
    .map((anchor) => {
      const href = absoluteUrl(STARZ_BASE, anchor.href);
      if (!href) return null;
      try {
        const parsed = new URL(href);
        if (!parsed.pathname.startsWith(basePath + "/") || parsed.pathname === basePath + "/") return null;
        const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
        const title = cleanText(stripTags(anchor.inner)) || chapterId;
        const number = asqChapterNumber(title, chapterId);
        if (!Number.isFinite(number)) return null;
        return { ...anchor, href, title, number };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const found = new Map();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const nextStart = anchors[index + 1]?.start ?? block.length;
    const row = block.slice(anchor.start, nextStart);
    const publishedAt = parseStarzPublishedAt(row, now);
    if (!publishedAt) continue;

    found.set(anchor.number, {
      number: anchor.number,
      title: anchor.title || "الفصل " + anchor.number,
      publishedAt,
      url: anchor.href,
    });
  }
  return [...found.values()].sort((a, b) =>
    Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || "") || b.number - a.number,
  );
}

function starzLatestItemsFromHtml(html, now = Date.now()) {
  const source = String(html ?? "");
  let blocks = madaraBlocksByClass(source, ["page-item-detail"]);
  if (!blocks.length) blocks = madaraBlocksByClass(source, ["c-tabs-item__content"]);

  const byKey = new Map();
  for (const block of blocks) {
    const item = starzItemsFromHtml(block)[0];
    if (!item) continue;

    let chapters = parseStarzChapters(block, item.url, now)
      .filter((chapter) => Boolean(chapter.publishedAt));
    if (!chapters.length) chapters = parseStarzLatestCardChapters(block, item.url, now);
    if (!chapters.length) continue;

    const candidate = {
      ...item,
      latest: Math.max(...chapters.map((chapter) => Number(chapter.number))),
      chapters,
    };
    byKey.set(candidate.key, candidate);
  }

  return [...byKey.values()];
}

async function starzChapter(db, item, number) {
  const series = await starzSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );

  // Some Madara series expose the chapter link in a different HTML block,
  // even though the chapter itself follows the normal /<series>/<number>/
  // route. Do not make the reader depend on the series-page parser finding
  // that row first.
  const chapterUrl = selected?.url
    ? new URL(selected.url, STARZ_BASE)
    : new URL(
        String(series.url || item.url).replace(/\/$/, "") + "/" + encodeURIComponent(String(number)) + "/",
        STARZ_BASE,
      );
  chapterUrl.searchParams.set("style", "list");

  let html = await starzFetchText(chapterUrl.toString(), false);
  let pages = parseStarzPages(html);
  if (!pages.length && selected?.url) {
    html = await starzFetchText(selected.url, false);
    pages = parseStarzPages(html);
  }
  if (!pages.length) throw new SourceError("NO_PAGES", "StarzManga لم يرجع صور الفصل.", 502);

  return {
    item: series,
    number,
    title: selected?.title || "الفصل " + number,
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



// Azora ------------------------------------------------------------------

async function azoraLatest(db, page) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const html = await azoraFetchText("/series/" + (params.size ? "?" + params.toString() : ""));
  const items = azoraItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: azoraHasNext(html, page), page };
}

async function azoraPopular(db, page) {
  const params = new URLSearchParams({ m_orderby: "trending" });
  if (page > 1) params.set("page", String(page));
  const html = await azoraFetchText("/series/?" + params.toString());
  const items = azoraItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: azoraHasNext(html, page), page };
}

async function azoraSearch(db, query, page) {
  const params = new URLSearchParams({ searchTerm: query });
  if (page > 1) params.set("page", String(page));
  const html = await azoraFetchText("/series/?" + params.toString());
  const items = azoraItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: azoraHasNext(html, page), page };
}

function resolveAzoraMediaUrl(value) {
  let current = absoluteUrl(AZORA_BASE, value);
  if (!current) return "";
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const parsed = new URL(current);
      const nested =
        parsed.searchParams.get("url") ||
        parsed.searchParams.get("src") ||
        parsed.searchParams.get("image") ||
        parsed.searchParams.get("imageUrl") ||
        parsed.searchParams.get("image_url");
      if (!nested) break;
      let decoded = nested;
      try { decoded = decodeURIComponent(nested); } catch {}
      const next = absoluteUrl(parsed.origin, decoded);
      if (!next || next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

function isAzoraUiImage(url) {
  return /(?:logo|favicon|avatar|profile|banner|icon|badge|placeholder|sprite|emoji|ads?)(?:[\/_-]|\.)/i.test(String(url));
}

function azoraItemsFromHtml(html) {
  const source = String(html ?? "");
  const bySlug = new Map();
  for (const anchor of extractAnchors(source)) {
    const href = absoluteUrl(AZORA_BASE, anchor.href);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    if (!/^(?:www\.)?azorafly\.com$/i.test(parsed.hostname)) continue;
    const match = parsed.pathname.match(/^\/series\/([^/]+)\/?$/i);
    if (!match) continue;
    const slug = decodeURIComponent(match[1]);
    if (!slug || bySlug.has(slug)) continue;

    const title = cleanText(
      anchor.attrs.title ||
      firstMatch(anchor.inner, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
      firstImgAttr(anchor.inner, "alt") ||
      stripTags(anchor.inner),
    );
    if (!title || /^image$/i.test(title) || /^الفصل\s+\d+/i.test(title)) continue;

    const rawCover = firstImgUrl(anchor.inner);
    const cover = resolveAzoraMediaUrl(rawCover);
    bySlug.set(slug, {
      key: "az:" + safeSlugKey(slug),
      source: "azora",
      sourceId: slug,
      slug,
      type: "series",
      url: AZORA_BASE + "/series/" + encodeURIComponent(slug),
      title,
      cover: cover && !isAzoraUiImage(cover) ? cover : "",
      description: "",
      status: "",
      genres: [],
    });
  }
  return [...bySlug.values()].slice(0, 80);
}

function azoraMetaContent(html, names) {
  const source = String(html ?? "");
  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs[String(match[1]).toLowerCase()] = match[2];
    }
    const key = String(attrs.property || attrs.name || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return attrs.content;
  }
  return "";
}

function azoraDescription(html) {
  return cleanText(azoraMetaContent(html, ["og:description", "description"]));
}

function azoraGenreCandidates(html) {
  const genres = [];
  for (const anchor of extractAnchors(String(html ?? ""))) {
    const href = String(anchor.href || "");
    if (!/(?:genres?=|\/genres?\/|\/genre\/)/i.test(href)) continue;
    const text = cleanText(stripTags(anchor.inner));
    if (text && text.length <= 40) genres.push(text);
  }
  return [...new Set(genres)];
}

function parseAzoraChapters(html, seriesUrl) {
  const source = String(html ?? "");
  const base = new URL(seriesUrl, AZORA_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const prefix = basePath + "/chapter-";
  const found = new Map();

  for (const anchor of extractAnchors(source)) {
    const href = absoluteUrl(AZORA_BASE, anchor.href);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(prefix)) continue;
    const tail = decodeURIComponent(parsed.pathname.slice(prefix.length)).replace(/\/$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(tail)) continue;
    const number = Number(tail);
    if (!Number.isFinite(number)) continue;
    found.set(number, {
      number,
      title: cleanText(stripTags(anchor.inner)) || "الفصل " + number,
      publishedAt: null,
      url: href,
    });
  }

  return [...found.values()].sort((a, b) => Number(b.number) - Number(a.number));
}

async function azoraSeries(db, item) {
  const seriesUrl = item.url || AZORA_BASE + "/series/" + encodeURIComponent(item.slug);
  const html = await azoraFetchText(seriesUrl);
  const title = cleanText(
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    azoraMetaContent(html, ["og:title", "twitter:title"]) ||
    item.title,
  );
  const metaCover = resolveAzoraMediaUrl(
    azoraMetaContent(html, ["og:image", "twitter:image", "twitter:image:src"]),
  );
  const cover = metaCover && !isAzoraUiImage(metaCover) ? metaCover : item.cover;
  const plain = cleanText(stripTags(html));
  const status = normalizeStatus(
    firstMatch(plain, /الحالة\s*:?\s*(مستمر|مستمرة|مكتمل|مكتملة|متوقف|ملغي|ملغية|توقف مؤقت)/i) ||
    firstMatch(plain, /status\s*:?\s*(ongoing|completed|hiatus|cancelled|canceled|dropped)/i) ||
    item.status,
  );
  const type = normalizeAsqType(
    firstMatch(plain, /(?:النوع|type)\s*:?\s*(رواية|مانهوا|مانها|مانغا|مانجا|كوميك|webtoon|manhwa|manhua|manga|novel|comic)/i) ||
    item.type,
  );
  const chapters = parseAzoraChapters(html, seriesUrl);
  const updated = {
    ...item,
    type,
    title,
    cover,
    description: azoraDescription(html) || item.description || "",
    status,
    genres: azoraGenreCandidates(html),
    latest: chapters[0]?.number ?? null,
    chapters,
  };
  await rememberItems(db, [updated]);
  return updated;
}

function parseAzoraPages(html) {
  const source = String(html ?? "");
  const numbered = new Map();
  const loose = [];

  for (const image of extractImages(source)) {
    const label = cleanText(image.attrs.alt || image.attrs.title || image.attrs["aria-label"] || "");
    const url = resolveAzoraMediaUrl(image.src);
    if (!url || isAzoraUiImage(url)) continue;
    const match = label.match(/(?:صفحة|page)\s*(\d+)/i);
    if (match && /(?:الفصل|chapter|page|صفحة)/i.test(label)) {
      numbered.set(Number(match[1]), url);
      continue;
    }
    if (/(?:reader|chapter|page)/i.test(String(image.attrs.class || ""))) loose.push(url);
  }

  if (numbered.size) {
    return [...numbered.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, url]) => url);
  }
  return [...new Set(loose)];
}

async function azoraChapter(db, item, number) {
  const series = await azoraSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );
  const chapterUrl =
    selected?.url ||
    String(series.url || item.url || "").replace(/\/$/, "") +
      "/chapter-" +
      encodeURIComponent(String(number));
  const html = await azoraFetchText(chapterUrl);
  const pages = parseAzoraPages(html);
  if (!pages.length) {
    throw new SourceError("CHAPTER_IMAGES_EMPTY", "Azora لم يرجع صور الفصل.", 502);
  }
  return {
    item: series,
    number,
    title: selected?.title || "الفصل " + number,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

async function azoraFetchText(pathOrUrl) {
  const target = new URL(pathOrUrl, AZORA_BASE).toString();
  let response;
  try {
    response = await fetch(target, {
      headers: sourceHeaders(
        AZORA_BASE,
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      cf: { cacheTtl: 30, cacheEverything: true },
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new SourceError("SOURCE_TIMEOUT", "Azora تأخر عن مهلة الاتصال.", 504);
    }
    throw new SourceError("SOURCE_NETWORK_ERROR", "تعذر الاتصال بـAzora.", 502);
  }

  if (!response.ok) {
    if (response.status === 429) throw new SourceError("SOURCE_RATE_LIMITED", "Azora حدّ الطلبات مؤقتًا.", 429);
    if (response.status === 403) throw new SourceError("SOURCE_RATE_LIMITED", "Azora رفض الطلب مؤقتًا.", 503);
    if (response.status >= 500) throw new SourceError("SOURCE_UPSTREAM_5XX", "Azora متعطل مؤقتًا.", 502);
    if (response.status === 404) throw new SourceError("SOURCE_NOT_FOUND", "المحتوى لم يعد موجودًا في Azora.", 404);
    throw new SourceError("SOURCE_UPSTREAM_ERROR", "Azora رجع HTTP " + response.status + ".", 502);
  }
  return response.text();
}

function azoraHasNext(html, page = 1) {
  if (/<a\b[^>]*(?:rel=["']next["']|class=["'][^"']*\bnext\b[^"']*["'])[^>]*>/i.test(html)) return true;
  return String(html ?? "").includes("page=" + (page + 1));
}

// MangaLik / Madara ----------------------------------------------------------

async function mangalikLatest(db, page) {
  // MangaLik exposes a dedicated newest-chapters stream. Parse that directly
  // so Wany never has to open every series page just to build New.
  const path = page > 1
    ? "/mangasid/page/" + page + "/"
    : "/mangasid/";
  const html = await mangalikFetchText(path);
  const items = mangalikLatestItemsFromHtml(html);

  if (items.length) {
    await rememberItems(db, items);
    return { items: items.slice(0, 48), hasMore: mangalikHasNext(html), page };
  }

  // Fail closed for strict New if the dedicated latest layout changes.
  return { items: [], hasMore: mangalikHasNext(html), page };
}

function parseMangalikLatestCardChapters(block, seriesUrl, now = Date.now()) {
  const base = new URL(seriesUrl, MANGALIK_BASE);
  const basePath = base.pathname.replace(/\/$/, "");

  const anchors = extractAnchors(block)
    .map((anchor) => {
      const href = absoluteUrl(MANGALIK_BASE, anchor.href);
      if (!href) return null;
      try {
        const parsed = new URL(href);
        if (!parsed.pathname.startsWith(basePath + "/") || parsed.pathname === basePath + "/") {
          return null;
        }
        const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
        const title = cleanText(stripTags(anchor.inner)) || chapterId;
        const number = asqChapterNumber(title, chapterId);
        if (!Number.isFinite(number)) return null;
        return { ...anchor, href, title, number };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const found = new Map();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const nextStart = anchors[index + 1]?.start ?? block.length;
    // Date belongs only to the interval after this chapter anchor and before
    // the next chapter anchor. This prevents sibling chapters sharing dates.
    const row = block.slice(anchor.start, nextStart);
    const publishedAt = parseMangalikPublishedAt(row, now);
    if (!publishedAt) continue;

    found.set(anchor.number, {
      number: anchor.number,
      title: anchor.title || "الفصل " + anchor.number,
      publishedAt,
      url: anchor.href,
    });
  }

  return [...found.values()].sort((a, b) =>
    Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || "") || b.number - a.number,
  );
}

function mangalikLatestItemsFromHtml(html, now = Date.now()) {
  const source = String(html ?? "");
  let blocks = madaraBlocksByClass(source, ["page-item-detail"]);
  if (!blocks.length) blocks = madaraBlocksByClass(source, ["c-tabs-item__content"]);

  const byKey = new Map();
  for (const block of blocks) {
    const item = mangalikItemsFromHtml(block)[0];
    if (!item) continue;

    let chapters = parseMangalikChapters(block, item.url)
      .filter((chapter) => Boolean(chapter.publishedAt));

    // MangaLik's newest page can render chapter rows without wp-manga-chapter
    // <li> wrappers. Fall back to exact anchor intervals inside the same card.
    if (!chapters.length) chapters = parseMangalikLatestCardChapters(block, item.url, now);
    if (!chapters.length) continue;

    const candidate = {
      ...item,
      latest: Math.max(...chapters.map((chapter) => Number(chapter.number))),
      chapters,
    };

    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, candidate);
      continue;
    }

    existing.chapters = [...existing.chapters, ...candidate.chapters]
      .filter((chapter, index, list) =>
        list.findIndex((entry) => Number(entry.number) === Number(chapter.number)) === index,
      )
      .sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""));
    existing.latest = Math.max(Number(existing.latest || 0), Number(candidate.latest || 0));
  }

  return [...byKey.values()];
}

async function mangalikPopular(db, page) {
  return mangalikList(db, { page, order: "views" });
}

async function mangalikList(db, { page, order }) {
  const html = await mangalikFetchText(
    "/manga/page/" + page + "/?m_orderby=" + encodeURIComponent(order),
  );
  const items = await mangalikItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: mangalikHasNext(html), page };
}

async function mangalikSearch(db, query, page) {
  const prefix = page > 1 ? "/page/" + page + "/" : "/";
  const html = await mangalikFetchText(
    prefix + "?s=" + encodeURIComponent(query) + "&post_type=wp-manga",
  );
  const items = await mangalikItemsFromHtml(html);
  await rememberItems(db, items);
  return { items: items.slice(0, 24), hasMore: mangalikHasNext(html), page };
}

async function mangalikItemsFromHtml(html) {
  const bySlug = new Map();
  const blocks = madaraBlocksByClass(html, ["c-tabs-item__content", "page-item-detail"]);
  const candidates = blocks.length ? blocks : [String(html ?? "")];

  for (const block of candidates) {
    for (const anchor of extractAnchors(block)) {
      const href = absoluteUrl(MANGALIK_BASE, anchor.href);
      if (!href) continue;

      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }

      if (!/^(?:www\.)?mangalik\.net$/i.test(parsed.hostname)) continue;
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

      const cover = absoluteUrl(MANGALIK_BASE, asqFirstImage(block));
      bySlug.set(slug, {
        key: "ml:" + safeSlugKey(slug),
        source: "mangalik",
        sourceId: slug,
        slug,
        type: "manga",
        url: MANGALIK_BASE + "/manga/" + encodeURIComponent(slug) + "/",
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

async function mangalikSeries(db, item) {
  const seriesUrl = item.url || MANGALIK_BASE + "/manga/" + encodeURIComponent(item.slug) + "/";
  const html = await mangalikFetchText(seriesUrl, false);

  const title = cleanText(
    firstMatch(html, /post-title[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      item.title,
  );

  const summaryImage =
    firstMatch(
      html,
      /<div\b[^>]*class=["'][^"']*\bsummary_image\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ) || "";
  const cover = absoluteUrl(MANGALIK_BASE, asqFirstImage(summaryImage) || item.cover);

  const description = cleanText(
    firstMatch(html, /description-summary[^>]*>([\s\S]*?)<\/div>/i) ||
      firstMatch(html, /manga-excerpt[^>]*>([\s\S]*?)<\/div>/i) ||
      "",
  );

  const plain = cleanText(stripTags(html));
  const status = normalizeStatus(
    firstMatch(plain, /الحالة\s*:?\s*(مستمرة|مستمر|مكتملة|مكتمل|متوقف|متروك)/i) ||
      firstMatch(plain, /status\s*:?\s*(ongoing|completed|hiatus|cancelled|canceled|dropped)/i) ||
      "",
  );

  const type = normalizeAsqType(
    firstMatch(
      plain,
      /النوع\s*:?\s*(رواية ويب|رواية|مانجا ويب|مانهوا|مانها|مانجا|كوميك)/i,
    ) ||
      firstMatch(
        plain,
        /type\s*:?\s*(web novel|light novel|novel|webtoon|manhwa|manhua|manga|comic)/i,
      ) ||
      item.type,
  );

  const genres = asqGenres(html);
  if (type === "novel" || type === "web-novel") genres.push("روايات");

  const chapters = parseMangalikChapters(html, seriesUrl);
  const updated = {
    ...item,
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

function parseMangalikPublishedAt(block, now = Date.now()) {
  const text = cleanText(stripTags(block))
    .replace(/،/g, ",")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .trim();
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  let relative = normalized.match(/(?:منذ\s*)?(\d+)\s*(دقيقة|دقائق|minute|minutes)\s*(?:ago)?/i);
  if (relative) return new Date(now - Number(relative[1]) * 60_000).toISOString();

  relative = normalized.match(/(?:منذ\s*)?(\d+)\s*(ساعة|ساعات|hour|hours)\s*(?:ago)?/i);
  if (relative) return new Date(now - Number(relative[1]) * 3_600_000).toISOString();

  // Day/week/month labels are intentionally rejected because they are too
  // coarse for Wany's strict <24h feed.
  if (/(?:يوم|ايام|أيام|day|days|week|weeks|month|months)/i.test(normalized)) return null;

  const months = {
    يناير: 0, فبراير: 1, مارس: 2, أبريل: 3, ابريل: 3, مايو: 4, يونيو: 5,
    يوليو: 6, أغسطس: 7, اغسطس: 7, سبتمبر: 8, أكتوبر: 9, اكتوبر: 9,
    نوفمبر: 10, ديسمبر: 11,
  };

  // MangaLik commonly renders dates as "سبتمبر 17, 2026".
  let match = text.match(/([\u0600-\u06ff]+)\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (match) {
    const month = months[match[1]];
    if (month != null) {
      const timestamp = Date.UTC(Number(match[3]), month, Number(match[2]));
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    }
  }

  // Keep support for the alternate Madara order "17 سبتمبر، 2026".
  match = text.match(/(\d{1,2})\s+([\u0600-\u06ff]+)\s*,?\s*(\d{4})/);
  if (match) {
    const month = months[match[2]];
    if (month != null) {
      const timestamp = Date.UTC(Number(match[3]), month, Number(match[1]));
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    }
  }

  return null;
}

function parseMangalikChapters(html, seriesUrl) {
  const base = new URL(seriesUrl, MANGALIK_BASE);
  const basePath = base.pathname.replace(/\/$/, "");
  const found = new Map();
  const regex =
    /<li\b[^>]*class=["'][^"']*\bwp-manga-chapter\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = regex.exec(String(html ?? "")))) {
    const block = match[1];
    const anchor = extractAnchors(block).find((entry) => {
      const href = absoluteUrl(MANGALIK_BASE, entry.href);
      if (!href) return false;
      try {
        const parsed = new URL(href);
        return parsed.pathname.startsWith(basePath + "/") && parsed.pathname !== basePath + "/";
      } catch {
        return false;
      }
    });
    if (!anchor) continue;

    const url = absoluteUrl(MANGALIK_BASE, anchor.href);
    if (!url) continue;
    const parsed = new URL(url);
    const chapterId = decodeURIComponent(parsed.pathname.slice(basePath.length + 1)).replace(/\/$/, "");
    const title = cleanText(stripTags(anchor.inner)) || chapterId;
    const number = asqChapterNumber(title, chapterId);
    if (!Number.isFinite(number)) continue;

    found.set(number, {
      number,
      title: title || "الفصل " + number,
      publishedAt: parseMangalikPublishedAt(block),
      url,
    });
  }

  return [...found.values()].sort((a, b) => b.number - a.number);
}

async function mangalikChapter(db, item, number) {
  const series = await mangalikSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );

  // MangaLik's Overgeared page is a concrete case where the series page can
  // list the chapter while the chapter row is not always captured by the
  // wp-manga-chapter parser. The source itself uses the stable
  // /manga/<slug>/<chapter>/ route, so the reader must be able to address that
  // route directly instead of treating a parser miss as "chapter unavailable".
  const baseUrl = String(series.url || item.url || "").replace(/\/$/, "");
  const directUrl = baseUrl
    ? baseUrl + "/" + encodeURIComponent(String(number)) + "/"
    : "";
  const chapterUrl = selected?.url
    ? new URL(selected.url, MANGALIK_BASE)
    : new URL(directUrl || MANGALIK_BASE, MANGALIK_BASE);

  // Prefer Madara's list reader, but do not depend on it. MangaLik sometimes
  // serves a different renderer for ?style=list while the normal chapter URL
  // still contains the real pages.
  chapterUrl.searchParams.set("style", "list");
  let html = await mangalikFetchText(chapterUrl.toString(), false);
  let pages = parseMangalikPages(html);

  if (!pages.length && selected?.url) {
    html = await mangalikFetchText(selected.url, false);
    pages = parseMangalikPages(html);
  }

  if (!pages.length && directUrl && selected?.url !== directUrl) {
    html = await mangalikFetchText(directUrl, false);
    pages = parseMangalikPages(html);
  }

  if (!pages.length) {
    throw new SourceError("NO_PAGES", "MangaLik لم يرجع صور الفصل.", 502);
  }

  return {
    item: series,
    number,
    title: selected?.title || "الفصل " + number,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

function parseMangalikPages(html) {
  const source = String(html ?? "");
  const pageBlocks = madaraBlocksByClass(source, ["page-break"]);
  const pages = [];

  for (const block of pageBlocks) {
    const image = extractImages(block)[0];
    const raw = image?.src || asqFirstImage(block);
    const url = absoluteUrl(MANGALIK_BASE, raw);
    if (url && !isMangalikUiImage(url)) pages.push(url);
  }

  if (pages.length) return [...new Set(pages)];

  const marker = source.search(/class=["'][^"']*\breading-content\b[^"']*["']/i);
  const tail = marker >= 0 ? source.slice(marker) : source;
  const footer = tail.search(/(?:id=["'](?:comments|manga-discussion)["']|<footer\b)/i);
  const scoped = footer >= 0 ? tail.slice(0, footer) : tail;

  const imagePages = extractImages(scoped)
    .map((image) => absoluteUrl(MANGALIK_BASE, image.src))
    .filter((url) => url && !isMangalikUiImage(url));
  if (imagePages.length) return [...new Set(imagePages)];

  // Some Madara optimizers inject chapter image URLs into inline JSON/script
  // instead of <img> tags. Accept only obvious image URLs inside the reader
  // scope and keep the same UI-image filter.
  const inlinePages = [];
  const normalized = scoped.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const urlRegex = /https?:\/\/[^"'<>\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\s]*)?/gi;
  let match;
  while ((match = urlRegex.exec(normalized))) {
    const url = absoluteUrl(MANGALIK_BASE, match[0]);
    if (url && !isMangalikUiImage(url)) inlinePages.push(url);
  }

  return [...new Set(inlinePages)];
}

function isMangalikUiImage(url) {
  return /(?:logo|avatar|favicon|icon|profile|banner|ads?)(?:[\/_-]|\.)/i.test(url);
}

async function mangalikFetchText(pathOrUrl, useBase = true) {
  const target = new URL(pathOrUrl, MANGALIK_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(
      MANGALIK_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: true },
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      throw new SourceError("MANGALIK_BLOCKED", "MangaLik رفض الطلب مؤقتًا.", 502);
    }
    throw new SourceError(
      "MANGALIK_UPSTREAM",
      "MangaLik رجع HTTP " + response.status + ".",
      502,
    );
  }

  return response.text();
}

function mangalikHasNext(html) {
  return /<a\b[^>]*(?:rel=["']next["']|class=["'][^"']*\bnext\b[^"']*["'])[^>]*>/i.test(html);
}


// XSano Manga / ZeistManga ---------------------------------------------------

async function xsanoCatalogLatest(db, page) {
  return xsanoFeedList(db, { page });
}

async function xsanoLatest(context, db, page) {
  if (page > 1) return { items: [], hasMore: false, page };

  const now = Date.now();
  const cutoffIso = new Date(now - 24 * 60 * 60_000).toISOString();
  const cached = await recentVerifiedReleasesFromDb(db, "xsano", cutoffIso);

  const state = await db
    .prepare("SELECT last_started_at FROM source_sync_state WHERE source = 'xsano' LIMIT 1")
    .first();
  const lastStartedAt = Number(state?.last_started_at ?? 0);

  if (now - lastStartedAt >= 15 * 60_000) {
    await db
      .prepare(`INSERT INTO source_sync_state (source, last_started_at)
        VALUES ('xsano', ?)
        ON CONFLICT(source) DO UPDATE SET last_started_at = excluded.last_started_at`)
      .bind(now)
      .run();

    context.waitUntil(
      syncXsanoLatest(db).catch((error) => {
        console.error("XSano background sync failed", error);
      }),
    );
  }

  return { items: cached, hasMore: false, page };
}

async function xsanoSeriesItemFromEntry(entry) {
  const categories = xsanoCategories(entry);
  if (!categories.includes("Series") || categories.includes("Anime")) return null;

  const title = xsanoText(entry?.title);
  const href = xsanoAlternateLink(entry);
  if (!title || !href) return null;

  const parsedUrl = new URL(href, XSANO_BASE);
  const sourceId = parsedUrl.pathname;
  const key = await makeSourceKey("xs", sourceId);
  const type = xsanoTypeFromCategories(categories);
  const genres = xsanoGenresFromCategories(categories, type);

  return {
    key,
    source: "xsano",
    sourceId,
    slug: parsedUrl.pathname.replace(/^\/+|\/+$/g, ""),
    type,
    url: parsedUrl.toString(),
    title,
    cover: xsanoEntryCover(entry),
    description: "",
    status: xsanoStatusFromCategories(categories),
    genres,
  };
}

async function xsanoResolveSeriesByLabels(labels) {
  for (const label of labels) {
    const url = new URL(
      "/feeds/posts/default/-/Series/" + encodeURIComponent(label),
      XSANO_BASE,
    );
    url.searchParams.set("alt", "json");
    url.searchParams.set("max-results", "2");

    try {
      const payload = await xsanoFetchJson(url.toString());
      const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry : [];
      for (const entry of entries) {
        const item = await xsanoSeriesItemFromEntry(entry);
        if (item) return item;
      }
    } catch {
      // A category can be a genre rather than the series label. Try the next.
    }
  }
  return null;
}

async function syncXsanoLatest(db) {
  const url = new URL("/feeds/posts/default/-/Chapter", XSANO_BASE);
  url.searchParams.set("alt", "json");
  url.searchParams.set("orderby", "published");
  url.searchParams.set("max-results", "100");

  const payload = await xsanoFetchJson(url.toString());
  const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry : [];
  const cutoff = Date.now() - 48 * 60 * 60_000;

  const recentEntries = entries.filter((entry) => {
    const publishedAt = xsanoText(entry?.published);
    const timestamp = Date.parse(publishedAt);
    return Number.isFinite(timestamp) && timestamp > cutoff &&
      xsanoCategories(entry).includes("Chapter");
  });

  // Resolve one series label per recent chapter group in the background.
  // Blogger's /Chapter/<series-label> convention guarantees a source-owned
  // label; genre labels are rejected unless they resolve to a Series entry.
  const groups = new Map();
  for (const entry of recentEntries) {
    const categories = xsanoCategories(entry).filter((value) => value !== "Chapter");
    const signature = categories.slice().sort().join("\u0001");
    if (!signature) continue;
    const group = groups.get(signature) ?? { labels: categories, entries: [] };
    group.entries.push(entry);
    groups.set(signature, group);
  }

  const values = [...groups.values()].slice(0, 40);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) break;
      const group = values[index];

      const item = await xsanoResolveSeriesByLabels(group.labels);
      if (!item) continue;

      const chapters = xsanoChaptersFromEntries(group.entries);
      if (!chapters.length) continue;

      await rememberItems(db, [item]);
      await rememberRecentVerifiedChapters(db, { ...item, chapters });
    }
  });

  await Promise.all(workers);
}

async function xsanoPopular(db, page) {
  // XSano has no separate popular catalogue; its source implementation mirrors latest.
  return xsanoFeedList(db, { page });
}

async function xsanoSearch(db, query, page) {
  return xsanoFeedList(db, { page, query });
}

async function xsanoFeedList(db, { page, query = "" }) {
  const startIndex = 20 * (page - 1) + 1;
  const url = new URL("/feeds/posts/default/-/Series", XSANO_BASE);
  url.searchParams.set("alt", "json");
  url.searchParams.set("orderby", "published");
  url.searchParams.set("max-results", "21");
  url.searchParams.set("start-index", String(startIndex));
  if (query) url.searchParams.set("q", "label:Series " + query);

  const payload = await xsanoFetchJson(url.toString());
  const entries = Array.isArray(payload?.feed?.entry) ? payload.feed.entry : [];
  const parsed = [];

  for (const entry of entries) {
    const item = await xsanoSeriesItemFromEntry(entry);
    if (item) parsed.push(item);
  }

  const hasMore = parsed.length > 20;
  const items = parsed.slice(0, 20);
  await rememberItems(db, items);
  return { items, hasMore, page };
}

async function xsanoSeries(db, item) {
  const html = await xsanoFetchText(item.url);
  const mainMarker = html.search(/<main\b/i);
  const scoped = mainMarker >= 0 ? html.slice(mainMarker) : html;
  const cover = absoluteUrl(XSANO_BASE, firstImgUrl(scoped)) || item.cover;
  const description = cleanText(
    firstMatch(scoped, /id=["']synopsis["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ||
      firstMatch(scoped, /id=["']synopsis["'][^>]*>([\s\S]*?)(?:<\/section>|<\/div>)/i) ||
      item.description ||
      "",
  );

  const info = xsanoInfoRows(scoped);
  const status = normalizeStatus(info.status || item.status || "");
  const detectedType = normalizeAsqType(info.type || item.type || "manga");
  const genres = [...new Set([
    ...(item.genres ?? []),
    ...xsanoGenresFromHtml(scoped),
    ...(detectedType === "novel" || detectedType === "web-novel" ? ["روايات"] : []),
  ])];

  const feedUrl = xsanoChapterFeedUrl(html);
  const chapters = await xsanoFetchChapters(feedUrl);
  const updated = {
    ...item,
    type: detectedType,
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

function xsanoInfoRows(html) {
  const out = { status: "", type: "" };
  const marker = String(html ?? "").search(/id=["']extra-info["']/i);
  const scoped = marker >= 0 ? String(html).slice(marker, marker + 120_000) : String(html ?? "");
  const regex = /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi;
  let match;
  while ((match = regex.exec(scoped))) {
    const block = match[1];
    const label = cleanText(firstMatch(block, /<dt\b[^>]*>([\s\S]*?)<\/dt>/i));
    const value = cleanText(firstMatch(block, /<dd\b[^>]*>([\s\S]*?)<\/dd>/i));
    if (!value) continue;
    if (/الحالة|status/i.test(label)) out.status = value;
    if (/النوع|type/i.test(label)) out.type = value;
  }
  return out;
}

function xsanoGenresFromHtml(html) {
  const genres = [];
  for (const anchor of extractAnchors(html)) {
    if (!/\btag\b/i.test(String(anchor.attrs.rel ?? ""))) continue;
    const value = cleanText(stripTags(anchor.inner));
    if (value && value.length <= 60) genres.push(value);
  }
  return genres;
}

function xsanoChapterFeedUrl(html) {
  const source = String(html ?? "");
  const clwd = source.match(/clwd\.run\(\s*["']([^"']+)["']\s*\)/i)?.[1];
  if (clwd) {
    return new URL(
      "/feeds/posts/default/-/Chapter/" + encodeURIComponent(clwd) + "?alt=json",
      XSANO_BASE,
    ).toString();
  }

  const oldMarker = source.search(/id=["']myUL["']/i);
  if (oldMarker >= 0) {
    const oldScope = source.slice(oldMarker, oldMarker + 80_000);
    const oldPath = oldScope.match(/<script\b[^>]*src=["']([^"']*\/feeds\/posts\/default\/-\/[^"'?]+)[^"']*["']/i)?.[1];
    if (oldPath) {
      const url = new URL(oldPath, XSANO_BASE);
      url.search = "";
      url.searchParams.set("alt", "json");
      return url.toString();
    }
  }

  const latestMarker = source.search(/id=["']latest["']/i);
  if (latestMarker >= 0) {
    const latestScope = source.slice(latestMarker, latestMarker + 80_000);
    const label = latestScope.match(/label\s*=\s*["']([^"']+)["']/i)?.[1];
    if (label) {
      return new URL(
        "/feeds/posts/default/-/" + encodeURIComponent(label) + "?alt=json",
        XSANO_BASE,
      ).toString();
    }
  }

  throw new SourceError("XSANO_CHAPTER_FEED", "تعذر العثور على قائمة فصول XSano.", 502);
}

async function xsanoFetchChapters(feedUrl) {
  const all = [];
  let start = 1;
  let total = Number.POSITIVE_INFINITY;

  for (let requestIndex = 0; requestIndex < 8 && start <= total; requestIndex += 1) {
    const url = new URL(feedUrl, XSANO_BASE);
    url.searchParams.set("alt", "json");
    url.searchParams.set("start-index", String(start));
    url.searchParams.set("max-results", "500");

    const payload = await xsanoFetchJson(url.toString());
    const feed = payload?.feed ?? {};
    const entries = Array.isArray(feed.entry) ? feed.entry : [];
    const reportedTotal = Number(xsanoText(feed["openSearch$totalResults"]));
    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;

    if (!entries.length) break;
    all.push(...entries);
    start += entries.length;
    if (entries.length < 500 && !Number.isFinite(reportedTotal)) break;
  }

  return xsanoChaptersFromEntries(all);
}

function xsanoChaptersFromEntries(entries) {
  const chapters = [];
  const seen = new Set();

  for (const entry of entries) {
    const categories = xsanoCategories(entry);
    if (!categories.includes("Chapter")) continue;

    const title = xsanoText(entry?.title);
    const url = xsanoAlternateLink(entry);
    if (!title || !url || seen.has(url)) continue;

    const number = asqChapterNumber(title, new URL(url, XSANO_BASE).pathname);
    if (!Number.isFinite(number)) continue;
    seen.add(url);
    chapters.push({
      number,
      title,
      publishedAt: xsanoText(entry?.published) || null,
      url: absoluteUrl(XSANO_BASE, url),
    });
  }

  return chapters.sort((a, b) => b.number - a.number);
}

async function xsanoChapter(db, item, number) {
  const series = await xsanoSeries(db, item);
  const selected = series.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(number)) < 0.000001,
  );
  if (!selected?.url) {
    throw new SourceError("CHAPTER_NOT_FOUND", "الفصل غير موجود في XSano.", 404);
  }

  const html = await xsanoFetchText(selected.url);
  const pages = parseXsanoPages(html);
  if (!pages.length) throw new SourceError("NO_PAGES", "XSano لم يرجع صور الفصل.", 502);

  return {
    item: series,
    number,
    title: selected.title || "الفصل " + number,
    pages,
    ...chapterNavigation(series.chapters ?? [], number),
  };
}

function parseXsanoPages(html) {
  const source = String(html ?? "");
  const marker = source.search(/id=["']reader["']/i);
  const tail = marker >= 0 ? source.slice(marker) : source;
  const footer = tail.search(/<footer\b/i);
  const scoped = footer >= 0 ? tail.slice(0, footer) : tail;
  const blocks = madaraBlocksByClass(scoped, ["separator"]);
  const pages = [];

  for (const block of blocks) {
    const image = extractImages(block).find((entry) => Boolean(entry.src));
    const url = absoluteUrl(XSANO_BASE, image?.src);
    if (url && !isXsanoUiImage(url)) pages.push(url);
  }

  if (pages.length) return [...new Set(pages)];

  return [...new Set(
    extractImages(scoped)
      .map((image) => absoluteUrl(XSANO_BASE, image.src))
      .filter((url) => url && !isXsanoUiImage(url)),
  )];
}

function isXsanoUiImage(url) {
  return /(?:logo|avatar|favicon|icon|profile|banner|ads?)(?:[\/_-]|\.)/i.test(url);
}

function xsanoCategories(entry) {
  return (Array.isArray(entry?.category) ? entry.category : [])
    .map((category) => String(category?.term ?? "").trim())
    .filter(Boolean);
}

function xsanoTypeFromCategories(categories) {
  const match = categories.find((value) =>
    /^(?:manga|manhwa|manhua|novel|web novel(?: \((?:jp|kr|cn)\))?|light novel)$/i.test(value),
  );
  return normalizeAsqType(match || "manga");
}

function xsanoStatusFromCategories(categories) {
  const match = categories.find((value) =>
    /^(?:ongoing|completed|hiatus|cancelled|canceled|dropped|مستمرة|مستمر|مكتملة|مكتمل|متوقف|متروك)$/i.test(value),
  );
  return normalizeStatus(match || "");
}

function xsanoGenresFromCategories(categories, type) {
  const ignored = new Set([
    "series", "anime", "manga", "manhwa", "manhua", "novel", "light novel",
    "web novel (jp)", "web novel (kr)", "web novel (cn)",
    "ongoing", "completed", "hiatus", "cancelled", "canceled", "dropped",
  ]);
  const genres = categories.filter((value) => !ignored.has(value.toLowerCase()));
  if (type === "novel" || type === "web-novel") genres.push("روايات");
  return [...new Set(genres)];
}

function xsanoEntryCover(entry) {
  const media = String(entry?.["media$thumbnail"]?.url ?? "").trim();
  if (media) return xsanoMaximizeImage(media);

  const content = xsanoText(entry?.content);
  const raw = content ? firstImgUrl(content) : "";
  return absoluteUrl(XSANO_BASE, xsanoMaximizeImage(raw));
}

function xsanoMaximizeImage(value) {
  const absolute = absoluteUrl(XSANO_BASE, value);
  if (!absolute) return "";
  return absolute
    .replace(/\/s\d+(?:-c)?\//i, "/w600/")
    .replace(/=s\d+(?:-c)?$/i, "=w600");
}

function xsanoAlternateLink(entry) {
  const links = Array.isArray(entry?.link) ? entry.link : [];
  const link = links.find((value) => value?.rel === "alternate" && value?.href);
  return link?.href ? absoluteUrl(XSANO_BASE, link.href) : "";
}

function xsanoText(node) {
  if (node && typeof node === "object" && "$t" in node) return String(node.$t ?? "");
  return typeof node === "string" ? node : "";
}

async function xsanoFetchJson(pathOrUrl) {
  const target = new URL(pathOrUrl, XSANO_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(XSANO_BASE, "application/json,text/plain,*/*"),
    redirect: "follow",
    cf: { cacheTtl: 45, cacheEverything: true },
  });
  if (!response.ok) {
    throw new SourceError("XSANO_UPSTREAM", "XSano رجع HTTP " + response.status + ".", 502);
  }
  return response.json();
}

async function xsanoFetchText(pathOrUrl) {
  const target = new URL(pathOrUrl, XSANO_BASE).toString();
  const response = await fetch(target, {
    headers: sourceHeaders(
      XSANO_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) {
    throw new SourceError("XSANO_UPSTREAM", "XSano رجع HTTP " + response.status + ".", 502);
  }
  return response.text();
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

async function proxyImage(source, rawUrl, rawReferer = "") {
  const base = source === "teamx"
    ? TEAMX_BASE
    : source === "3asq"
      ? ASQ_BASE
      : source === "starzmanga"
        ? STARZ_BASE
        : source === "xsano"
          ? XSANO_BASE
          : source === "mangalik"
            ? MANGALIK_BASE
            : source === "azora"
              ? AZORA_BASE
              : MANGATIME_BASE;
  const target = absoluteUrl(base, rawUrl);
  if (!target) return json({ error: "INVALID_IMAGE_URL" }, 400);

  const parsed = new URL(target);
  if (!["http:", "https:"].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return json({ error: "INVALID_IMAGE_HOST" }, 400);
  }

  const imageAccept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
  let requestedReferer = base;
  if (rawReferer) {
    try {
      const parsedReferer = new URL(rawReferer, base);
      const sourceOrigin = new URL(base).origin;
      if (
        ["http:", "https:"].includes(parsedReferer.protocol) &&
        parsedReferer.origin === sourceOrigin
      ) {
        requestedReferer = parsedReferer.toString();
      }
    } catch {}
  }

  const fetchImage = (refererBase) => {
    const headers = sourceHeaders(refererBase, imageAccept);

    // Azora reader images are stricter about the chapter Referer. When the
    // caller supplied an exact chapter URL, preserve it byte-for-byte instead
    // of letting sourceHeaders append another "/" (e.g. /65//).
    if (source === "azora" && rawReferer) {
      try {
        const exactReferer = new URL(rawReferer, AZORA_BASE);
        if (exactReferer.origin === new URL(AZORA_BASE).origin) {
          headers.Referer = exactReferer.toString();
        }
      } catch {}
    }

    return fetch(target, {
      headers,
      redirect: "follow",
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
  };

  // Reader images can require the exact chapter URL as Referer. The client
  // already sends it; preserve it here instead of collapsing every request to
  // the source homepage. If the CDN rejects that, retry against the image
  // origin below.
  let response = await fetchImage(requestedReferer);
  let type = response.headers.get("Content-Type") ?? "";
  // Chapter pages on Azora commonly serve images from external storage/CDN
  // hosts. Those hosts may reject a azorafly.com Referer even though the image
  // URL itself is valid. Retry against the image origin, just as MangaTime
  // already does for its CDN covers, without transforming the image bytes.
  if ((source === "mangatime" || source === "azora") &&
      parsed.origin !== new URL(base).origin &&
      (!response.ok || !type.toLowerCase().startsWith("image/"))) {
    response = await fetchImage(parsed.origin);
    type = response.headers.get("Content-Type") ?? "";
  }

  if (!response.ok) return json({ error: "IMAGE_UPSTREAM", status: response.status }, 502);
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
    ...(base === MANGATIME_BASE
      ? {
          "X-MT-Platform": "web",
          "X-MT-UIMode": "standard",
        }
      : {}),
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
    const src =
      attrs["data-src"] ||
      attrs["data-lazy-src"] ||
      attrs["data-original"] ||
      attrs["data-url"] ||
      attrs["data-lazy"] ||
      bestSrcset(attrs["data-srcset"]) ||
      bestSrcset(attrs["data-lazy-srcset"]) ||
      bestSrcset(attrs.srcset) ||
      attrs.src;
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
  parseTeamXPublishedAt,
  teamXLatestSection,
  parseTeamXPages,
  parseAsqChapters,
  parseAsqPublishedAt,
  asqLatestItemsFromHtml,
  asqLatestItemsFromArchiveHtml,
  parseAsqLatestCardChapters,
  parseAsqRecentPublishedAt,
  asqSafeSeriesTitle,
  asqLatestItemIsSane,
  parseAsqPages,
  asqPostId,
  parseStarzChapters,
  parseStarzPublishedAt,
  parseStarzLatestCardChapters,
  starzLatestItemsFromHtml,
  parseStarzPages,
  parseMangalikChapters,
  parseMangalikPublishedAt,
  mangalikLatestItemsFromHtml,
  parseMangalikLatestCardChapters,
  parseMangalikPages,
  azoraItemsFromHtml,
  azoraDescription,
  azoraGenreCandidates,
  parseAzoraChapters,
  parseAzoraPages,
  starzPostId,
  parseXsanoPages,
  xsanoChapterFeedUrl,
  xsanoChaptersFromEntries,
  xsanoTypeFromCategories,
  asqChapterNumber,
  normalizeAsqType,
  priorityWindow,
  priorityRefreshActive,
  sourceRefreshIntervalMs,
  mangaTimeChaptersFromPayload,
  mangaTimePagesFromPayload,
  parseMangaTimePages,
  mangaTimeChapterUrl,
  mangaTimeTypeGenres,
  mangaTimeSeriesGenres,
  mangaTimeSearchInput,
  mangaTimeTrpc,
  sourceHeaders,
  isNovelLabel,
  normalizeStatus,
};