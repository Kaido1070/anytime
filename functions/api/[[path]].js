const SESSION_COOKIE = "anytime_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210000;
const MAX_JSON_BYTES = 32 * 1024;

const SEEDED_USERS = [
  {
    id: "mahdi",
    username: "mahdi",
    name: "Mahdi",
    salt: "nckWsLoOqPQ2ko0y6KFcdQ",
    hash: "Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE",
  },
  {
    id: "kaido",
    username: "kaido",
    name: "Kaido",
    salt: "w-fi6L0FIdkx0NNSYyhvdg",
    hash: "g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y",
  },
  {
    id: "ahmed",
    username: "ahmed",
    name: "Ahmed",
    salt: "4ueIIy1PaWKbbDjqIkf39g",
    hash: "Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI",
  },
];

const SEEDED_FAVORITES = {
  mahdi: ["returner", "solo"],
  kaido: ["eleceed", "horizon"],
  ahmed: ["solo", "returner"],
};

const SEEDED_PROGRESS = [
  ["mahdi", "returner", 141, 100, 1],
  ["mahdi", "returner", 142, 100, 1],
  ["mahdi", "returner", 143, 62, 0],
  ["kaido", "eleceed", 315, 45, 0],
  ["ahmed", "solo", 197, 55, 0],
];

export async function onRequest(context) {
  const request = context.request;
  const db = context.env?.DB;
  if (!db) {
    return json(
      {
        error: "D1_NOT_CONFIGURED",
        message: "قاعدة بيانات Anytime غير مربوطة بالموقع بعد.",
      },
      503,
    );
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return json({ error: "NOT_FOUND" }, 404);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);
  }

  try {
    await ensureDatabase(db);
    return await route(request, url, db);
  } catch (error) {
    console.error("Anytime API error", error);
    return json(
      {
        error: "SERVER_ERROR",
        message: "صار خطأ أثناء مزامنة المكتبة. حاول مرة ثانية.",
      },
      500,
    );
  }
}

async function route(request, url, db) {
  const path = url.pathname.replace(/^\/api\/?/, "");

  if (request.method === "GET" && path === "health") {
    return json({ ok: true, phase: 2, database: "ready" });
  }

  if (request.method === "POST" && path === "login") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || password.length < 1 || password.length > 128) {
      return json({ error: "INVALID_LOGIN", message: "بيانات الدخول غير صحيحة." }, 401);
    }

    const user = await db
      .prepare(
        "SELECT id, username, name, password_salt, password_hash, password_iterations FROM users WHERE username = ? LIMIT 1",
      )
      .bind(username)
      .first();

    if (!user || !(await verifyPassword(password, user))) {
      await sleep(120);
      return json({ error: "INVALID_LOGIN", message: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
    }

    const token = randomToken(32);
    const tokenHash = await sha256Base64Url(token);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      db
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(tokenHash, user.id, now, now, expiresAt),
    ]);

    return json(
      { user: publicUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS) },
    );
  }

  if (request.method === "POST" && path === "logout") {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      const tokenHash = await sha256Base64Url(token);
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    return json(
      { ok: true },
      200,
      { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
    );
  }

  if (request.method === "GET" && path === "session") {
    const session = await getSession(request, db);
    return json({ user: session ? publicUser(session.user) : null });
  }

  const session = await getSession(request, db);
  if (!session) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }
  const user = session.user;

  if (request.method === "GET" && path === "data") {
    return json({ data: await getUserData(db, user.id) });
  }

  if (request.method === "POST" && path === "favorites") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    await db
      .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
      .bind(user.id, mangaId, Date.now())
      .run();
    return json({ ok: true });
  }

  const favoriteMatch = path.match(/^favorites\/([^/]+)$/);
  if (request.method === "DELETE" && favoriteMatch) {
    const mangaId = safeId(decodeURIComponent(favoriteMatch[1]));
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    await db
      .prepare("DELETE FROM favorites WHERE user_id = ? AND manga_id = ?")
      .bind(user.id, mangaId)
      .run();
    return json({ ok: true });
  }

  if (request.method === "PUT" && path === "progress") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const chapter = Number(body.chapter);
    const percent = Number(body.percent);
    const clientUpdatedAt = Number(body.updatedAt);
    if (
      !mangaId ||
      !Number.isInteger(chapter) ||
      chapter < 0 ||
      !Number.isFinite(percent)
    ) {
      return json({ error: "INVALID_PROGRESS" }, 400);
    }

    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const updatedAt = Number.isFinite(clientUpdatedAt)
      ? Math.min(Math.max(0, clientUpdatedAt), Date.now() + 5 * 60 * 1000)
      : Date.now();
    const completed = normalizedPercent >= 98 ? 1 : 0;

    await db.batch([
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET
             percent = excluded.percent,
             completed = CASE WHEN reading_progress.completed = 1 OR excluded.completed = 1 THEN 1 ELSE 0 END,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= reading_progress.updated_at`,
        )
        .bind(user.id, mangaId, chapter, normalizedPercent, completed, updatedAt),
      db
        .prepare(
          `INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             last_manga_id = excluded.last_manga_id,
             last_chapter = excluded.last_chapter,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= user_state.updated_at`,
        )
        .bind(user.id, mangaId, chapter, updatedAt),
    ]);

    return json({ ok: true });
  }

  if (request.method === "GET" && path === "friends") {
    return json({ friends: await getFriends(db, user.id) });
  }

  if (request.method === "POST" && path === "friends") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    if (!username) return json({ error: "INVALID_USERNAME" }, 400);
    const friend = await db
      .prepare("SELECT id, username, name FROM users WHERE username = ? LIMIT 1")
      .bind(username)
      .first();
    if (!friend || friend.id === user.id) {
      return json({ error: "FRIEND_NOT_FOUND", message: "ما لقينا هذا الحساب." }, 404);
    }
    const now = Date.now();
    await db.batch([
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(user.id, friend.id, now),
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(friend.id, user.id, now),
    ]);
    return json({ friend: publicUser(friend) }, 201);
  }

  const friendMatch = path.match(/^friends\/([^/]+)$/);
  if (request.method === "DELETE" && friendMatch) {
    const friendId = safeId(decodeURIComponent(friendMatch[1]));
    if (!friendId) return json({ error: "INVALID_FRIEND" }, 400);
    await db.batch([
      db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(user.id, friendId),
      db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(friendId, user.id),
    ]);
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "import") {
    const body = await readJson(request);
    await importLegacyData(db, user.id, body.data);
    return json({ data: await getUserData(db, user.id) });
  }

  if (request.method === "POST" && path === "change-password") {
    const body = await readJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 4 || newPassword.length > 128) {
      return json({ error: "WEAK_PASSWORD", message: "كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر." }, 400);
    }

    const authRow = await db
      .prepare(
        "SELECT id, password_salt, password_hash, password_iterations FROM users WHERE id = ? LIMIT 1",
      )
      .bind(user.id)
      .first();
    if (!authRow || !(await verifyPassword(currentPassword, authRow))) {
      return json({ error: "WRONG_PASSWORD", message: "كلمة المرور الحالية غير صحيحة." }, 400);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bytesToBase64Url(saltBytes);
    const hash = await derivePasswordHash(newPassword, saltBytes, PASSWORD_ITERATIONS);
    const now = Date.now();
    await db
      .prepare(
        "UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?",
      )
      .bind(salt, hash, PASSWORD_ITERATIONS, now, user.id)
      .run();
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
      .bind(user.id, session.tokenHash)
      .run();
    return json({ ok: true });
  }

  return json({ error: "NOT_FOUND" }, 404);
}

async function ensureDatabase(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    .run();
  const version = await db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version' LIMIT 1")
    .first();
  if (version?.value === "2") return;

  const now = Date.now();
  const statements = [
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_iterations INTEGER NOT NULL DEFAULT 210000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, manga_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reading_progress (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      percent REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, manga_id, chapter),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON reading_progress(user_id, updated_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      last_manga_id TEXT,
      last_chapter INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id),
      CHECK (user_id <> friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
  ];

  for (const seeded of SEEDED_USERS) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO users
            (id, username, name, password_salt, password_hash, password_iterations, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          seeded.id,
          seeded.username,
          seeded.name,
          seeded.salt,
          seeded.hash,
          PASSWORD_ITERATIONS,
          now,
          now,
        ),
    );
  }

  for (const [userId, favorites] of Object.entries(SEEDED_FAVORITES)) {
    for (const mangaId of favorites) {
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
          .bind(userId, mangaId, now),
      );
    }
  }

  for (const [userId, mangaId, chapter, percent, completed] of SEEDED_PROGRESS) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, mangaId, chapter, percent, completed, now),
    );
  }

  for (const [userId, mangaId, chapter] of [
    ["mahdi", "returner", 143],
    ["kaido", "eleceed", 315],
    ["ahmed", "solo", 197],
  ]) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO user_state (user_id, last_manga_id, last_chapter, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(userId, mangaId, chapter, now),
    );
  }

  for (const user of SEEDED_USERS) {
    for (const friend of SEEDED_USERS) {
      if (user.id === friend.id) continue;
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
          .bind(user.id, friend.id, now),
      );
    }
  }

  statements.push(
    db
      .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '2')"),
  );
  await db.batch(statements);
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT
         s.token_hash, s.user_id, s.expires_at, s.last_seen_at,
         u.id, u.username, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first();
  if (!row) return null;
  if (now - Number(row.last_seen_at) > 60 * 60 * 1000) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash)
      .run();
  }
  return {
    tokenHash,
    user: { id: row.id, username: row.username, name: row.name },
  };
}

async function getUserData(db, userId) {
  const [favoriteResult, progressResult, state] = await Promise.all([
    db
      .prepare("SELECT manga_id FROM favorites WHERE user_id = ? ORDER BY created_at ASC")
      .bind(userId)
      .all(),
    db
      .prepare(
        "SELECT manga_id, chapter, percent, completed, updated_at FROM reading_progress WHERE user_id = ?",
      )
      .bind(userId)
      .all(),
    db
      .prepare("SELECT last_manga_id, last_chapter FROM user_state WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first(),
  ]);

  const progress = {};
  const completed = [];
  for (const row of progressResult.results ?? []) {
    const key = `${row.manga_id}:${row.chapter}`;
    progress[key] = {
      mangaId: row.manga_id,
      chapter: Number(row.chapter),
      percent: Number(row.percent),
      updatedAt: Number(row.updated_at),
    };
    if (Number(row.completed) === 1) completed.push(key);
  }

  return {
    version: 2,
    favorites: (favoriteResult.results ?? []).map((row) => row.manga_id),
    progress,
    completed,
    lastOpened:
      state?.last_manga_id != null && state?.last_chapter != null
        ? { mangaId: state.last_manga_id, chapter: Number(state.last_chapter) }
        : null,
  };
}

async function getFriends(db, userId) {
  const result = await db
    .prepare(
      `SELECT u.id, u.username, u.name
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
        `SELECT user_id, manga_id, chapter, updated_at
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
  for (const row of progressResult.results ?? []) {
    if (!reading.has(row.user_id)) {
      reading.set(row.user_id, {
        mangaId: row.manga_id,
        chapter: Number(row.chapter),
      });
    }
  }

  return users.map((friend) => ({
    user: publicUser(friend),
    reading: reading.get(friend.id) ?? null,
    favorites: favorites.get(friend.id) ?? [],
  }));
}

async function importLegacyData(db, userId, data) {
  if (!data || typeof data !== "object") return;
  const favorites = Array.isArray(data.favorites) ? data.favorites.map(safeId).filter(Boolean) : [];
  const progressEntries = data.progress && typeof data.progress === "object"
    ? Object.values(data.progress)
    : [];
  const completed = new Set(Array.isArray(data.completed) ? data.completed.filter((value) => typeof value === "string") : []);
  const statements = [];
  const now = Date.now();

  for (const mangaId of favorites.slice(0, 500)) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
        .bind(userId, mangaId, now),
    );
  }

  for (const item of progressEntries.slice(0, 2000)) {
    if (!item || typeof item !== "object") continue;
    const mangaId = safeId(item.mangaId);
    const chapter = Number(item.chapter);
    const percent = Number(item.percent);
    const incomingUpdatedAt = Number(item.updatedAt);
    if (!mangaId || !Number.isInteger(chapter) || chapter < 0 || !Number.isFinite(percent)) continue;
    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const key = `${mangaId}:${chapter}`;
    const isCompleted = completed.has(key) || normalizedPercent >= 98 ? 1 : 0;
    const updatedAt = Number.isFinite(incomingUpdatedAt) && incomingUpdatedAt > 0
      ? Math.min(incomingUpdatedAt, Date.now() + 5 * 60 * 1000)
      : 0;
    statements.push(
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET
             percent = excluded.percent,
             completed = CASE WHEN reading_progress.completed = 1 OR excluded.completed = 1 THEN 1 ELSE 0 END,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > reading_progress.updated_at`,
        )
        .bind(userId, mangaId, chapter, normalizedPercent, isCompleted, updatedAt),
    );
  }

  for (const key of [...completed].slice(0, 2000)) {
    const split = key.lastIndexOf(":");
    if (split <= 0) continue;
    const mangaId = safeId(key.slice(0, split));
    const chapter = Number(key.slice(split + 1));
    if (!mangaId || !Number.isInteger(chapter) || chapter < 0) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, 100, 1, 0)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET completed = 1`,
        )
        .bind(userId, mangaId, chapter),
    );
  }

  const lastMangaId = safeId(data.lastOpened?.mangaId);
  const lastChapter = Number(data.lastOpened?.chapter);
  if (lastMangaId && Number.isInteger(lastChapter) && lastChapter >= 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             last_manga_id = excluded.last_manga_id,
             last_chapter = excluded.last_chapter,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, lastMangaId, lastChapter, now),
    );
  }

  if (statements.length) await db.batch(statements);
}

async function verifyPassword(password, row) {
  const salt = base64UrlToBytes(row.password_salt);
  const derived = await derivePasswordHash(password, salt, Number(row.password_iterations));
  return timingSafeEqual(base64UrlToBytes(derived), base64UrlToBytes(row.password_hash));
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function sessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name };
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : "";
}

function safeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(normalized) ? normalized : "";
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new Error("Request body too large");
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return {};
  return await request.json();
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
