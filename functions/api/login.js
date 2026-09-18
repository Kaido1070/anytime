const SESSION_COOKIE = "anytime_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 25000;

const PRIVATE_ACCOUNTS = [
  { id: "mahdi", username: "has", name: "Has" },
  { id: "kaido", username: "yas", name: "Yas" },
  { id: "ahmed", username: "mah", name: "Mah" },
];

const DEFAULT_PASSWORD_MIGRATIONS = new Map([
  [
    "Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE",
    "dN13h-kpkhGSQJVBkmDOvXb69LKMwGicgTtea0zEAdE",
  ],
  [
    "g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y",
    "hb284Iod4PzsMFaR1UF0ZeovMGnQi2XHETuB_oPGFLU",
  ],
  [
    "Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI",
    "a6i7k3yCu28zBKb6rGpJFeJLV8WmWRn3wH18pGbrwWc",
  ],
]);

export async function onRequestPost(context) {
  const { request } = context;
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
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);

  try {
    await syncPrivateAccountNames(db);

    const body = await request.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || password.length < 1 || password.length > 128) {
      return json(
        { error: "INVALID_LOGIN", message: "بيانات الدخول غير صحيحة." },
        401,
      );
    }

    let user = await db
      .prepare(
        "SELECT id, username, name, profile_visibility, avatar_id, password_salt, password_hash, password_iterations FROM users WHERE username = ? LIMIT 1",
      )
      .bind(username)
      .first();

    if (!user) {
      await sleep(100);
      return json(
        {
          error: "INVALID_LOGIN",
          message: "اسم المستخدم أو كلمة المرور غير صحيحة.",
        },
        401,
      );
    }

    user = await migrateDefaultPasswordIfNeeded(db, user);

    if (!(await verifyPassword(password, user))) {
      await sleep(100);
      return json(
        {
          error: "INVALID_LOGIN",
          message: "اسم المستخدم أو كلمة المرور غير صحيحة.",
        },
        401,
      );
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
  } catch (error) {
    console.error("Anytime login error", error);
    return json(
      {
        error: "SERVER_ERROR",
        message: "صار خطأ أثناء تسجيل الدخول. حاول مرة ثانية.",
      },
      500,
    );
  }
}

async function syncPrivateAccountNames(db) {
  const now = Date.now();
  await db.batch(
    PRIVATE_ACCOUNTS.map((account) =>
      db
        .prepare(
          "UPDATE users SET username = ?, name = ?, updated_at = ? WHERE id = ? AND (username <> ? OR name <> ?)",
        )
        .bind(
          account.username,
          account.name,
          now,
          account.id,
          account.username,
          account.name,
        ),
    ),
  );
}

async function migrateDefaultPasswordIfNeeded(db, user) {
  const nextHash = DEFAULT_PASSWORD_MIGRATIONS.get(String(user.password_hash));
  if (!nextHash || Number(user.password_iterations) !== 210000) return user;

  const now = Date.now();
  await db
    .prepare(
      "UPDATE users SET password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ? AND password_hash = ? AND password_iterations = 210000",
    )
    .bind(nextHash, PASSWORD_ITERATIONS, now, user.id, user.password_hash)
    .run();

  return {
    ...user,
    password_hash: nextHash,
    password_iterations: PASSWORD_ITERATIONS,
  };
}

async function verifyPassword(password, row) {
  const salt = base64UrlToBytes(row.password_salt);
  const derived = await derivePasswordHash(
    password,
    salt,
    Number(row.password_iterations),
  );
  return timingSafeEqual(
    base64UrlToBytes(derived),
    base64UrlToBytes(row.password_hash),
  );
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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function sessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    profileVisibility: row.profile_visibility === "public" ? "public" : "private",
    avatarId: row.avatar_id ?? null,
  };
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : "";
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
