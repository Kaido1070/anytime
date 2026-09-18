const SESSION_COOKIE = "anytime_session";

export async function onRequest(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return json(
      { error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع." },
      503,
    );
  }

  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return json(
      { error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." },
      401,
    );
  }
  if (user.role === "admin") {
    return json({ error: "ADMIN_NOT_SOCIAL" }, 403);
  }

  if (request.method === "GET") {
    const [followed, readingWorks] = await Promise.all([
      getFollowed(env.DB, user.id),
      getReadingWorks(env.DB, user.id),
    ]);
    return json({ followed, readingWorks });
  }

  if (request.method === "POST") {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return json({ error: "BAD_ORIGIN" }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const requested = Array.isArray(body?.chapters) ? body.chapters : [];
    const chapters = requested
      .map((item) => ({
        mangaId: safeSourceKey(item?.mangaId),
        chapter: Number(item?.chapter),
      }))
      .filter((item) => item.mangaId && Number.isFinite(item.chapter) && item.chapter >= 0)
      .slice(0, 320);

    if (!chapters.length) return json({ read: [] });

    const clauses = chapters.map(() => "(manga_id = ? AND ABS(chapter - ?) < 0.000001)").join(" OR ");
    const binds = [user.id];
    for (const chapter of chapters) {
      binds.push(chapter.mangaId, chapter.chapter);
    }

    const result = await env.DB
      .prepare(`SELECT DISTINCT manga_id, chapter
        FROM reading_history
        WHERE user_id = ? AND (${clauses})`)
      .bind(...binds)
      .all();

    return json({
      read: (result.results ?? []).map((row) => ({
        mangaId: String(row.manga_id),
        chapter: Number(row.chapter),
      })),
    });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

async function getFollowed(db, userId) {
  const result = await db
    .prepare(`SELECT manga_id, MIN(started_at) AS tracking_started_at
      FROM (
        SELECT manga_id, added_at AS started_at
        FROM user_library
        WHERE user_id = ?
        UNION ALL
        SELECT manga_id, created_at AS started_at
        FROM favorites
        WHERE user_id = ?
        UNION ALL
        SELECT i.manga_id, i.added_at AS started_at
        FROM user_list_items i
        JOIN user_lists l ON l.id = i.list_id
        WHERE l.user_id = ?
      )
      GROUP BY manga_id
      ORDER BY tracking_started_at ASC, manga_id ASC`)
    .bind(userId, userId, userId)
    .all();

  return (result.results ?? []).map((row) => ({
    mangaId: String(row.manga_id),
    trackingStartedAt: Number(row.tracking_started_at),
  }));
}

async function getReadingWorks(db, userId) {
  const result = await db
    .prepare(`SELECT
        manga_id,
        COUNT(DISTINCT chapter) AS read_count,
        MAX(read_at) AS last_read_at,
        MAX(chapter) AS highest_chapter
      FROM reading_history
      WHERE user_id = ?
      GROUP BY manga_id
      ORDER BY last_read_at DESC, manga_id ASC`)
    .bind(userId)
    .all();

  return (result.results ?? []).map((row) => ({
    mangaId: String(row.manga_id),
    readCount: Number(row.read_count ?? 0),
    lastReadAt: row.last_read_at == null ? null : Number(row.last_read_at),
    highestChapter: row.highest_chapter == null ? null : Number(row.highest_chapter),
  }));
}

async function getSessionUser(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  return db
    .prepare(`SELECT u.id, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
      LIMIT 1`)
    .bind(tokenHash, Date.now())
    .first();
}

function safeSourceKey(value) {
  const key = String(value ?? "").trim();
  return /^(mt|tx|aq|sz|xs|ml):[A-Za-z0-9_-]{1,110}$/.test(key) ? key : "";
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
