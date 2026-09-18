import { ensureAdminSchema } from "../_admin.js";
import { ensureAdminAccount } from "../_admin_provision.js";

const PASSWORD_ITERATIONS = 25000;
const RECOVERY_ITERATIONS = 210000;

const RECOVERY_SEEDS = [
  ["admin", "iXMrYFxlRGeNeXtahvJrxg", "qB91GPghZPSkaJ4EkLZlQ4O33bYMktRSEWQ8TzHiJ08"],
  ["m", "DQKmZM9LWDe-yvsralJ3NA", "gk2_0df_3o7dJprXj1IzLcRnJUUmiGF1YgfjXKhe0T8"],
  ["Y", "yzbZYsIxWd_q11a259Vekg", "JkkmyqM-AxXhtFvjyuGw2_tgIOix_C1O0Zww0gEowC0"],
  ["H", "kfncionM84kNNDTiZGagDQ", "hYOzUUBxo4VWBLVZHUpPbWyufAcPqN11e6GckRtyO_c"],
];

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
    await ensureRecoveryCodes(db);

    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!/^[a-z0-9_-]{1,64}$/.test(username) || recoveryCode.length < 20 || recoveryCode.length > 128) {
      await sleep(250);
      return invalidRecovery();
    }
    if (newPassword.length < 4 || newPassword.length > 128) {
      return json({ error: "WEAK_PASSWORD", message: "كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر." }, 400);
    }

    const row = await db.prepare(`
      SELECT u.id, r.recovery_salt, r.recovery_hash, r.recovery_iterations
      FROM users u JOIN account_recovery r ON r.user_id = u.id
      WHERE u.username = ? COLLATE NOCASE LIMIT 1
    `).bind(username).first();

    if (!row || !(await verifyRecoveryCode(recoveryCode, row))) {
      await sleep(250);
      return invalidRecovery();
    }

    const passwordSaltBytes = crypto.getRandomValues(new Uint8Array(16));
    const passwordSalt = bytesToBase64Url(passwordSaltBytes);
    const passwordHash = await deriveHash(newPassword, passwordSaltBytes, PASSWORD_ITERATIONS);
    const now = Date.now();

    await db.batch([
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
        .bind(passwordSalt, passwordHash, PASSWORD_ITERATIONS, now, row.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
    ]);

    return json({ ok: true });
  } catch (error) {
    console.error("Wany recovery error", error instanceof Error ? error.message : "unknown");
    return json({ error: "SERVER_ERROR", message: "تعذر استعادة الحساب الآن." }, 500);
  }
}

async function ensureRecoveryCodes(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS account_recovery (
    user_id TEXT PRIMARY KEY,
    recovery_salt TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    recovery_iterations INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();

  const now = Date.now();
  for (const [username, salt, hash] of RECOVERY_SEEDS) {
    await db.prepare(`
      INSERT INTO account_recovery
        (user_id, recovery_salt, recovery_hash, recovery_iterations, created_at)
      SELECT id, ?, ?, ?, ? FROM users WHERE username = ? COLLATE NOCASE LIMIT 1
      ON CONFLICT(user_id) DO UPDATE SET
        recovery_salt = excluded.recovery_salt,
        recovery_hash = excluded.recovery_hash,
        recovery_iterations = excluded.recovery_iterations
    `).bind(salt, hash, RECOVERY_ITERATIONS, now, username).run();
  }
}

async function verifyRecoveryCode(value, row) {
  const salt = base64UrlToBytes(row.recovery_salt);
  const derived = await deriveHash(value, salt, Number(row.recovery_iterations));
  return timingSafeEqual(base64UrlToBytes(derived), base64UrlToBytes(row.recovery_hash));
}

async function deriveHash(value, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function invalidRecovery() {
  return json({ error: "INVALID_RECOVERY", message: "اسم المستخدم أو رمز الاستعادة غير صحيح." }, 401);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
