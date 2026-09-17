const SESSION_COOKIE = "anytime_session";

export async function onRequestPut(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);

  const session = await getSession(request, db);
  if (!session) return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);

  try {
    const body = await request.json();
    const mangaId = safeId(body.mangaId);
    const chapter = Number(body.chapter);
    const percent = Number(body.percent);
    const clientUpdatedAt = Number(body.updatedAt);
    if (!mangaId || !Number.isFinite(chapter) || chapter < 0 || !Number.isFinite(percent)) {
      return json({ error: "INVALID_PROGRESS" }, 400);
    }

    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const updatedAt = Number.isFinite(clientUpdatedAt)
      ? Math.min(Math.max(0, clientUpdatedAt), Date.now() + 5 * 60 * 1000)
      : Date.now();
    const completed = normalizedPercent >= 98 ? 1 : 0;

    await db.batch([
      db
        .prepare(`INSERT INTO reading_progress
          (user_id, manga_id, chapter, percent, completed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET
           percent = excluded.percent,
           completed = CASE WHEN reading_progress.completed = 1 OR excluded.completed = 1 THEN 1 ELSE 0 END,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= reading_progress.updated_at`)
        .bind(session.userId, mangaId, chapter, normalizedPercent, completed, updatedAt),
      db
        .prepare(`INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           last_manga_id = excluded.last_manga_id,
           last_chapter = excluded.last_chapter,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= user_state.updated_at`)
        .bind(session.userId, mangaId, chapter, updatedAt),
    ]);

    return json({ ok: true });
  } catch (error) {
    console.error("Anytime progress error", error);
    return json({ error: "SERVER_ERROR", message: "تعذر حفظ تقدم القراءة." }, 500);
  }
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

function safeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(normalized) ? normalized : "";
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
