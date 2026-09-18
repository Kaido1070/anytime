const SESSION_COOKIE = "anytime_session";
const DEMO_IDS = ["returner", "solo", "eleceed", "horizon"];

export async function onRequestPost(context) {
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
  await db.batch([
    db.prepare(`DELETE FROM favorites WHERE manga_id IN (${placeholders})`).bind(...DEMO_IDS),
    db.prepare(`DELETE FROM reading_progress WHERE manga_id IN (${placeholders})`).bind(...DEMO_IDS),
    db.prepare(`DELETE FROM user_library WHERE manga_id IN (${placeholders})`).bind(...DEMO_IDS),
    db.prepare(`DELETE FROM reading_history WHERE manga_id IN (${placeholders})`).bind(...DEMO_IDS),
    db
      .prepare(`UPDATE user_state SET last_manga_id = NULL, last_chapter = NULL, updated_at = ? WHERE last_manga_id IN (${placeholders})`)
      .bind(Date.now(), ...DEMO_IDS),
  ]);

  return json({ ok: true });
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
