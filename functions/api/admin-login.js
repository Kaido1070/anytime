import { verifyPassword, verifyMissingUser } from "../_password.js";
import { ensureAdminSchema, isAdminUser, recordAdminAudit, sessionUser } from "../_admin.js";
import { mutationOriginError, readAuthJson, normalizeLoginName, reserveAuthAttempt, rateLimited, authError } from "../_auth-security.js";

const SESSION_COOKIE = "anytime_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  const originError = mutationOriginError(request);
  if (originError) return originError;

  try {
    try {
      await ensureAdminSchema(db);
    } catch (error) {
      return adminStageError("ADMIN_SCHEMA_FAILED", error);
    }

    const body = await readAuthJson(request);
    const username = normalizeLoginName(body.username);
    const suppliedSecret = typeof body.password === "string" ? body.password : "";
    if (!(await reserveAuthAttempt(db, request, "login", username))) return rateLimited();
    if (!username || !suppliedSecret || suppliedSecret.length > 128) {
      return invalidLogin();
    }

    let user;
    try {
      user = await db
        .prepare(`SELECT id, username, name, profile_visibility, avatar_id, role,
          password_salt, password_hash, password_iterations
          FROM users WHERE username = ? COLLATE NOCASE AND role = 'admin' LIMIT 1`)
        .bind(username)
        .first();
    } catch (error) {
      return adminStageError("ADMIN_LOOKUP_FAILED", error);
    }

    if (!(user && isAdminUser(user) ? await verifyPassword(suppliedSecret, user) : await verifyMissingUser(suppliedSecret))) {
      await sleep(120);
      return invalidLogin();
    }

    const token = randomToken(32);
    const tokenHash = await sha256Base64Url(token);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    try {
      const issued = await db.batch([
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
        db.prepare(
          `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
           SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND password_hash = ? AND role = 'admin'`,
        ).bind(tokenHash, now, now, expiresAt, user.id, user.password_hash),
      ]);
      if (Number(issued[1]?.meta?.changes) !== 1) return invalidLogin();
      await recordAdminAudit(db, user.id, "admin_login");
    } catch (error) {
      return adminStageError("ADMIN_SESSION_FAILED", error);
    }

    return json(
      { user: sessionUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS) },
    );
  } catch (error) {
    return adminStageError("ADMIN_LOGIN_FAILED", error);
  }
}

function adminStageError(code, error) {
  const safeError = authError(error);
  if (safeError) return safeError;
  console.error("Anytime admin login error", code, error instanceof Error ? error.name : "unknown");
  return json(
    {
      error: code,
      message: `تعذر تسجيل الدخول الآن. (${code})`,
    },
    500,
  );
}

function invalidLogin() {
  return json({ error: "INVALID_LOGIN", message: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomToken(size) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
