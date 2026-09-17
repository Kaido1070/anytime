const SESSION_COOKIE = "anytime_session";
const MAX_JSON_BYTES = 8 * 1024;

export async function onRequest({ request, env }) {
  const db = env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);
  }

  await ensureProfileColumn(db);
  const session = await getSession(request, db);
  if (!session) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }

  if (request.method === "GET") {
    const row = await db
      .prepare("SELECT profile_private FROM users WHERE id = ? LIMIT 1")
      .bind(session.userId)
      .first();
    return json({ profilePrivate: Number(row?.profile_private ?? 0) === 1 });
  }

  if (request.method === "PATCH") {
    const body = await readJson(request);
    if (typeof body.private !== "boolean") {
      return json({ error: "INVALID_PROFILE_VISIBILITY" }, 400);
    }
    const value = body.private ? 1 : 0;
    await db
      .prepare("UPDATE users SET profile_private = ?, updated_at = ? WHERE id = ?")
      .bind(value, Date.now(), session.userId)
      .run();
    return json({ profilePrivate: Boolean(value) });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

async function ensureProfileColumn(db) {
  const columns = await db.prepare("PRAGMA table_info(users)").all();
  const exists = (columns.results ?? []).some((column) => column.name === "profile_private");
  if (!exists) {
    await db
      .prepare("ALTER TABLE users ADD COLUMN profile_private INTEGER NOT NULL DEFAULT 0")
      .run()
      .catch((error) => {
        if (!/duplicate column|already exists/i.test(String(error?.message ?? error))) throw error;
      });
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

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) return {};
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return {};
  return request.json();
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
