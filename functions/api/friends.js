const SESSION_COOKIE = "anytime_session";
const MAX_JSON_BYTES = 8 * 1024;

export async function onRequest({ request, env }) {
  const db = env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  if (request.method === "POST") {
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
    return json({ friends: await getFriends(db, session.userId) });
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    if (!username) return json({ error: "INVALID_USERNAME" }, 400);

    const friend = await db
      .prepare("SELECT id, username, name FROM users WHERE username = ? LIMIT 1")
      .bind(username)
      .first();

    if (!friend || friend.id === session.userId) {
      return json({ error: "FRIEND_NOT_FOUND", message: "ما لقينا هذا الحساب." }, 404);
    }

    const now = Date.now();
    await db.batch([
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(session.userId, friend.id, now),
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(friend.id, session.userId, now),
    ]);

    return json({ friend: publicUser(friend) }, 201);
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

async function getFriends(db, userId) {
  const result = await db
    .prepare(
      `SELECT u.id, u.username, u.name, u.profile_private
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?
       ORDER BY u.name COLLATE NOCASE ASC`,
    )
    .bind(userId)
    .all();

  const users = result.results ?? [];
  if (!users.length) return [];

  const ids = users.map((user) => user.id);
  const placeholders = ids.map(() => "?").join(",");
  const [favoritesResult, stateResult, progressResult] = await Promise.all([
    db
      .prepare(`SELECT user_id, manga_id FROM favorites WHERE user_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...ids)
      .all(),
    db
      .prepare(`SELECT user_id, last_manga_id, last_chapter FROM user_state WHERE user_id IN (${placeholders})`)
      .bind(...ids)
      .all(),
    db
      .prepare(
        `SELECT user_id, manga_id, chapter, percent, updated_at
         FROM reading_progress
         WHERE user_id IN (${placeholders})
         ORDER BY updated_at DESC`,
      )
      .bind(...ids)
      .all(),
  ]);

  const favorites = new Map(ids.map((id) => [id, []]));
  for (const row of favoritesResult.results ?? []) {
    favorites.get(row.user_id)?.push(row.manga_id);
  }

  const reading = new Map();
  for (const row of stateResult.results ?? []) {
    if (row.last_manga_id != null && row.last_chapter != null) {
      reading.set(row.user_id, {
        mangaId: row.last_manga_id,
        chapter: Number(row.last_chapter),
      });
    }
  }

  const history = new Map(ids.map((id) => [id, new Map()]));
  for (const row of progressResult.results ?? []) {
    if (!reading.has(row.user_id)) {
      reading.set(row.user_id, {
        mangaId: row.manga_id,
        chapter: Number(row.chapter),
      });
    }

    const userHistory = history.get(row.user_id);
    if (userHistory && !userHistory.has(row.manga_id)) {
      userHistory.set(row.manga_id, {
        mangaId: row.manga_id,
        chapter: Number(row.chapter),
        percent: Number(row.percent),
        updatedAt: Number(row.updated_at),
      });
    }
  }

  return users.map((friend) => {
    const profilePrivate = Number(friend.profile_private ?? 0) === 1;
    return {
      user: publicUser(friend),
      private: profilePrivate,
      reading: profilePrivate ? null : reading.get(friend.id) ?? null,
      favorites: favorites.get(friend.id) ?? [],
      history: profilePrivate ? [] : [...(history.get(friend.id)?.values() ?? [])],
    };
  });
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

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name };
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : "";
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
