export const PASSWORD_ITERATIONS = 25000;

export async function verifyPassword(password, row, db) {
  const alternatives = db ? await db.prepare(`SELECT password_salt, password_hash, password_iterations
    FROM user_password_verifiers WHERE user_id = ?`).bind(row.id).all() : { results: [] };
  const candidates = [row, ...(alternatives.results ?? [])].filter(candidate =>
    typeof candidate.password_salt === "string" && typeof candidate.password_hash === "string");
  let unsupported = false;
  for (const candidate of candidates) {
    try {
      const derived = await derivePasswordHash(password, base64UrlToBytes(candidate.password_salt), Number(candidate.password_iterations));
      if (constantTimeEqual(base64UrlToBytes(derived), base64UrlToBytes(candidate.password_hash))) return true;
    } catch (error) {
      if (error?.name !== "NotSupportedError" && !String(error?.message).includes("iteration counts above")) throw error;
      unsupported = true;
    }
  }
  if (unsupported) {
    const error = new Error("An existing credential requires a compatible runtime or reviewed credential upgrade.");
    error.code = "CREDENTIAL_RUNTIME_UNSUPPORTED";
    throw error;
  }
  return false;
}

export function constantTimeEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

export function decodeBase64Url(value) { return base64UrlToBytes(value); }

export async function derivePasswordHash(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Invalid credential parameters.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  return Uint8Array.from(atob(String(value).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

export async function replacePassword(db, userId, expectedHash, salt, hash, currentTokenHash) {
  const results = await db.batch([
    db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ? AND password_hash = ?")
      .bind(salt, hash, PASSWORD_ITERATIONS, Date.now(), userId, expectedHash),
    db.prepare("DELETE FROM user_password_verifiers WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)")
      .bind(userId, userId, hash),
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)")
      .bind(userId, currentTokenHash, userId, hash),
  ]);
  return Number(results[0]?.meta?.changes) === 1;
}
