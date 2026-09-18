import { ensureAdminSchema, isAdminUser, recordAdminAudit, sessionUser } from "../_admin.js";
import { ensureAdminAccount } from "../_admin_provision.js";

const SESSION_COOKIE = "anytime_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);

  try {
    await ensureAdminSchema(db);
    await ensureAdminAccount(db, context.env);

    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const suppliedSecret = typeof body.password === "string" ? body.password : "";
    if (username !== "admin" || !suppliedSecret || suppliedSecret.length > 128) {
      return invalidLogin();
    }

    const user = await db
      .prepare(`SELECT id, username, name, profile_visibility, avatar_id, role,
        password_salt, password_hash, password_iterations
        FROM users WHERE username = ? COLLATE NOCASE AND role = 'admin' LIMIT 1`)
      .bind("Admin")
      .first();

    if (!user || !isAdminUser(user) || !(await verifySecret(suppliedSecret, user))) {
      await sleep(120);
      return invalidLogin();
    }

    const token = randomToken(32);
    const tokenHash = await sha256Base64Url(token);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(tokenHash, user.id, now, now, expiresAt),
    ]);
    await recordAdminAudit(db, user.id, "admin_login");

    return json(
      { user: sessionUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS) },
    );
  } catch (error) {
    console.error("Anytime admin login error", error instanceof Error ? error.message : "unknown");
    return json({ error: "SERVER_ERROR", message: "تعذر تسجيل الدخول الآن." }, 500);
  }
}

function invalidLogin() {
  return json({ error: "INVALID_LOGIN", message: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
}

async function verifySecret(value, row) {
  const salt = base64UrlToBytes(row.password_salt);
  const derived = await deriveHash(value, salt, Number(row.password_iterations));
  return timingSafeEqual(base64UrlToBytes(derived), base64UrlToBytes(row.password_hash));
}

async function deriveHash(value, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
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
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

function randomToken(size) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
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

function sessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`;
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
