const PASSWORD_ITERATIONS = 25000;
const RECOVERY_ITERATIONS = 210000;
const Y_RECOVERY_DIGEST = new Uint8Array([139,141,171,9,182,99,41,214,238,191,98,37,238,19,94,139,41,144,75,21,104,77,198,209,255,107,252,42,20,165,79,158]);

const RECOVERY_SEEDS = [
  ["admin", "iXMrYFxlRGeNeXtahvJrxg", "qB91GPghZPSkaJ4EkLZlQ4O33bYMktRSEWQ8TzHiJ08"],
  ["m", "DQKmZM9LWDe-yvsralJ3NA", "gk2_0df_3o7dJprXj1IzLcRnJUUmiGF1YgfjXKhe0T8"],
  ["yas", "yzbZYsIxWd_q11a259Vekg", "JkkmyqM-AxXhtFvjyuGw2_tgIOix_C1O0Zww0gEowC0"],
  ["has", "kfncionM84kNNDTiZGagDQ", "hYOzUUBxo4VWBLVZHUpPbWyufAcPqN11e6GckRtyO_c"],
];

const RECOVERY_ACCOUNT_IDS = {
  admin: "admin",
  m: "m",
  y: "yas",
  yas: "yas",
  h: "has",
  has: "has",
};

const RECOVERY_BY_ID = Object.fromEntries(
  RECOVERY_SEEDS.map(([userId, salt, hash]) => [userId, { salt, hash }]),
);

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);

  let stage = "INIT";
  try {
    stage = "BODY";
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const accountId = RECOVERY_ACCOUNT_IDS[username] ?? null;
    const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!accountId || recoveryCode.length < 20 || recoveryCode.length > 128) {
      await sleep(250);
      return invalidRecovery("RCV-401-A");
    }
    if (newPassword.length < 4 || newPassword.length > 128) {
      return json({ error: "WEAK_PASSWORD", reference: "RCV-400-PASS", message: "كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر. [RCV-400-PASS]" }, 400);
    }

    stage = "USER";
    const row = await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(accountId).first();
    const recoverySeed = RECOVERY_BY_ID[accountId];

    if (!row || !recoverySeed) {
      await sleep(250);
      return invalidRecovery("RCV-401-U");
    }

    stage = "VERIFY";
    let recoveryMatches;
    if (accountId === "yas") {
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(recoveryCode)),
      );
      recoveryMatches = timingSafeEqual(digest, Y_RECOVERY_DIGEST);
    } else {
      const derivedRecoveryHash = await deriveHash(
        recoveryCode,
        base64UrlToBytes(recoverySeed.salt),
        RECOVERY_ITERATIONS,
      );
      recoveryMatches = timingSafeEqual(
        base64UrlToBytes(derivedRecoveryHash),
        base64UrlToBytes(recoverySeed.hash),
      );
    }
    if (!recoveryMatches) {
      await sleep(250);
      return invalidRecovery("RCV-401-C");
    }

    stage = "PASSWORD";
    const passwordSaltBytes = crypto.getRandomValues(new Uint8Array(16));
    const passwordSalt = bytesToBase64Url(passwordSaltBytes);
    const passwordHash = await deriveHash(newPassword, passwordSaltBytes, PASSWORD_ITERATIONS);
    const now = Date.now();

    stage = "WRITE";
    await db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
      .bind(passwordSalt, passwordHash, PASSWORD_ITERATIONS, now, row.id)
      .run();

    stage = "SESSIONS";
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();

    return json({ ok: true, reference: "RCV-200" });
  } catch (error) {
    const reference = `RCV-500-${stage}`;
    console.error("Wany recovery error", reference, error instanceof Error ? error.message : "unknown");
    return json({ error: "SERVER_ERROR", reference, message: `تعذر استعادة الحساب الآن. [${reference}]` }, 500);
  }
}

async function deriveHash(value, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function invalidRecovery(reference = "RCV-401") {
  return json({
    error: "INVALID_RECOVERY",
    reference,
    message: `اسم المستخدم أو رمز الاستعادة غير صحيح. [${reference}]`,
  }, 401);
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
