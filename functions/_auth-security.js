const schemaReady = new WeakMap();

export function mutationOriginError(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  if (request.headers.get("Origin") !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return response({ error: "BAD_ORIGIN" }, 403);
  }
  return null;
}

export function normalizeLoginName(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().slice(0, 129) : "";
}

export async function readAuthJson(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    const error = new Error("JSON required"); error.code = "INVALID_JSON"; throw error;
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); const error = new Error("Body too large"); error.code = "BODY_TOO_LARGE"; throw error; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(data));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { const error = new Error("Invalid JSON"); error.code = "INVALID_JSON"; throw error; }
}

// All isolates share bounded fixed-window counters in D1. Keys contain hashes only.
// Login and admin-login share a scope so switching endpoints cannot reset a budget.
export async function reserveAuthAttempt(db, request, scope, identity, now = Date.now()) {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      const version = await db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version' LIMIT 1").first();
      const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_attempt_windows'").first();
      if (!table || !Number.isFinite(Number(version?.value)) || Number(version?.value) < 20) {
        const error = new Error("Apply reviewed security migrations"); error.code = "SCHEMA_MIGRATION_REQUIRED"; throw error;
      }
    })().catch(error => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, ready);
  }
  await ready;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const windowMs = 15 * 60 * 1000;
  const specs = [[`${scope}:ip:${ip}`, 60], [`${scope}:pair:${ip}:${identity}`, 8], [`${scope}:account:${identity}`, 24]];
  const keys = await Promise.all(specs.map(async ([value]) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }));
  const statements = specs.map(([, limit], i) => db.prepare(`
    INSERT INTO auth_attempt_windows (bucket_key, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    WHERE window_start <= ? OR attempts < ?`)
    .bind(keys[i], now, now - windowMs, now - windowMs, now - windowMs, limit));
  // Bounded cleanup; the indexed timestamp also limits retained identifier digests.
  await db.prepare(`DELETE FROM auth_attempt_windows WHERE bucket_key IN
    (SELECT bucket_key FROM auth_attempt_windows WHERE window_start <= ? LIMIT 100)`)
    .bind(now - windowMs * 2).run();
  // Refuse an exhausted IP before allocating more account keys for random names.
  const ipResult = await statements[0].run();
  if (Number(ipResult?.meta?.changes) !== 1) return false;
  const results = await db.batch(statements.slice(1));
  return results.every(result => Number(result?.meta?.changes) === 1);
}

export function rateLimited() {
  return response({ error: "TOO_MANY_ATTEMPTS", message: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة ثانية." }, 429, { "Retry-After": "900" });
}

export function authError(error) {
  const code = error?.code;
  if (code === "BODY_TOO_LARGE") return response({ error: code }, 413);
  if (code === "INVALID_JSON") return response({ error: code }, 400);
  if (["SCHEMA_MIGRATION_REQUIRED", "CREDENTIAL_RUNTIME_UNSUPPORTED"].includes(code)) return response({ error: code }, 503);
  return null;
}

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

export function newSessionToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sessionTokenHash(token) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function authCookie(token) {
  return `anytime_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? 30 * 24 * 60 * 60 : 0}`;
}
