import { mutationOriginError } from "../_auth-security.js";
const SESSION_COOKIE = "anytime_session";
const DEMO_IDS = ["returner", "solo", "eleceed", "horizon"];

export async function onRequestPost(context) {
  const originError = mutationOriginError(context.request);
  if (originError) return originError;
  const db = context.env?.DB;
  if (!db) {
    return json(
      { error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع بعد." },
      503,
    );
  }

  const token = getCookie(context.request, SESSION_COOKIE);
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);

  const tokenHash = await sha256Base64Url(token);
  const session = await db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1")
    .bind(tokenHash, Date.now())
    .first();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const placeholders = DEMO_IDS.map(() => "?").join(",");
  const hasDemo = await db
    .prepare(`SELECT 1 AS present
      WHERE EXISTS (
        SELECT 1 FROM favorites WHERE user_id = ? AND manga_id IN (${placeholders})
      )
      OR EXISTS (
        SELECT 1 FROM reading_progress WHERE user_id = ? AND manga_id IN (${placeholders})
      )
      OR EXISTS (
        SELECT 1 FROM user_library WHERE user_id = ? AND manga_id IN (${placeholders})
      )
      OR EXISTS (
        SELECT 1 FROM reading_history WHERE user_id = ? AND manga_id IN (${placeholders})
      )
      OR EXISTS (
        SELECT 1 FROM user_state WHERE user_id = ? AND last_manga_id IN (${placeholders})
      )
      LIMIT 1`)
    .bind(
      session.user_id, ...DEMO_IDS,
      session.user_id, ...DEMO_IDS,
      session.user_id, ...DEMO_IDS,
      session.user_id, ...DEMO_IDS,
      session.user_id, ...DEMO_IDS,
    )
    .first();
  if (!hasDemo) return json({ ok: true, changed: false });

  await db.batch([
    db.prepare(`DELETE FROM favorites WHERE user_id = ? AND manga_id IN (${placeholders})`)
      .bind(session.user_id, ...DEMO_IDS),
    db.prepare(`DELETE FROM reading_progress WHERE user_id = ? AND manga_id IN (${placeholders})`)
      .bind(session.user_id, ...DEMO_IDS),
    db.prepare(`DELETE FROM user_library WHERE user_id = ? AND manga_id IN (${placeholders})`)
      .bind(session.user_id, ...DEMO_IDS),
    db.prepare(`DELETE FROM reading_history WHERE user_id = ? AND manga_id IN (${placeholders})`)
      .bind(session.user_id, ...DEMO_IDS),
    db
      .prepare(`UPDATE user_state
        SET last_manga_id = NULL, last_chapter = NULL, updated_at = ?
        WHERE user_id = ? AND last_manga_id IN (${placeholders})`)
      .bind(Date.now(), session.user_id, ...DEMO_IDS),
  ]);

  return json({ ok: true, changed: true });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
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
