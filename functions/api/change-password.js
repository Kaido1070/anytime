const SESSION_COOKIE = "anytime_session";
const PASSWORD_ITERATIONS = 25000;

const DEFAULT_PASSWORD_MIGRATIONS = new Map([
  ["Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE", "dN13h-kpkhGSQJVBkmDOvXb69LKMwGicgTtea0zEAdE"],
  ["g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y", "hb284Iod4PzsMFaR1UF0ZeovMGnQi2XHETuB_oPGFLU"],
  ["Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI", "a6i7k3yCu28zBKb6rGpJFeJLV8WmWRn3wH18pGbrwWc"],
]);

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع بعد." }, 503);

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);

  try {
    const session = await getSession(request, db);
    if (!session) return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);

    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 4 || newPassword.length > 128) {
      return json({ error: "WEAK_PASSWORD", message: "كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر." }, 400);
    }

    let authRow = await db
      .prepare("SELECT id, password_salt, password_hash, password_iterations FROM users WHERE id = ? LIMIT 1")
      .bind(session.user.id)
      .first();
    if (!authRow) return json({ error: "UNAUTHORIZED" }, 401);

    authRow = await migrateDefaultPasswordIfNeeded(db, authRow);
    if (!(await verifyPassword(currentPassword, authRow))) {
      return json({ error: "WRONG_PASSWORD", message: "كلمة المرور الحالية غير صحيحة." }, 400);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bytesToBase64Url(saltBytes);
    const hash = await derivePasswordHash(newPassword, saltBytes, PASSWORD_ITERATIONS);
    const now = Date.now();
    await db
      .prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
      .bind(salt, hash, PASSWORD_ITERATIONS, now, session.user.id)
      .run();
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
      .bind(session.user.id, session.tokenHash)
      .run();

    return json({ ok: true });
  } catch (error) {
    console.error("Anytime change-password error", error);
    return json({ error: "SERVER_ERROR", message: "تعذر تغيير كلمة المرور الآن." }, 500);
  }
}

async function migrateDefaultPasswordIfNeeded(db, user) {
  const nextHash = DEFAULT_PASSWORD_MIGRATIONS.get(String(user.password_hash));
  if (!nextHash || Number(user.password_iterations) !== 210000) return user;
  await db
    .prepare("UPDATE users SET password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ? AND password_hash = ? AND password_iterations = 210000")
    .bind(nextHash, PASSWORD_ITERATIONS, Date.now(), user.id, user.password_hash)
    .run();
  return { ...user, password_hash: nextHash, password_iterations: PASSWORD_ITERATIONS };
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const row = await db
    .prepare(`SELECT s.token_hash, s.user_id, s.expires_at, u.id, u.username, u.name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`)
    .bind(tokenHash, now)
    .first();
  if (!row) return null;
  return { tokenHash, user: { id: row.id, username: row.username, name: row.name } };
}

async function verifyPassword(password, row) {
  const salt = base64UrlToBytes(row.password_salt);
  const derived = await derivePasswordHash(password, salt, Number(row.password_iterations));
  return timingSafeEqual(base64UrlToBytes(derived), base64UrlToBytes(row.password_hash));
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
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

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
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
