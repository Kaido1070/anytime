const ADMIN_ID = "admin";
const ADMIN_USERNAME = "Admin";
const ADMIN_INTERNAL_USERNAME = "__wany_admin__";
const ADMIN_PASSWORD_ITERATIONS = 210000;

export async function ensureAdminAccount(db, env) {
  const initialSecret =
    typeof env?.ADMIN_INITIAL_PASSWORD === "string" ? env.ADMIN_INITIAL_PASSWORD : "";
  if (!initialSecret) return { configured: false, created: false };
  if (initialSecret.length < 8 || initialSecret.length > 128) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be between 8 and 128 characters.");
  }

  const existingById = await db
    .prepare("SELECT id, username, role FROM users WHERE id = ? LIMIT 1")
    .bind(ADMIN_ID)
    .first();
  const existingByUsername = await db
    .prepare("SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
    .bind(ADMIN_USERNAME)
    .first();
  const existing = existingById ?? (existingByUsername?.role === "admin" ? existingByUsername : null);

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await deriveHash(initialSecret, saltBytes, ADMIN_PASSWORD_ITERATIONS);
  const now = Date.now();

  if (existing) {
    const username =
      existingByUsername && existingByUsername.id !== existing.id
        ? ADMIN_INTERNAL_USERNAME
        : ADMIN_USERNAME;
    await db
      .prepare(`UPDATE users
        SET username = ?, name = ?, profile_visibility = 'private',
            password_salt = ?, password_hash = ?, password_iterations = ?,
            role = 'admin', updated_at = ?
        WHERE id = ?`)
      .bind(
        username,
        ADMIN_USERNAME,
        salt,
        hash,
        ADMIN_PASSWORD_ITERATIONS,
        now,
        existing.id,
      )
      .run();
    await purgeSocialRowsBestEffort(db, existing.id);
    return { configured: true, created: false, userId: existing.id };
  }

  const username = existingByUsername ? ADMIN_INTERNAL_USERNAME : ADMIN_USERNAME;
  await db
    .prepare(`INSERT INTO users
      (id, username, name, profile_visibility, password_salt, password_hash, password_iterations, created_at, updated_at, role)
      VALUES (?, ?, ?, 'private', ?, ?, ?, ?, ?, 'admin')`)
    .bind(ADMIN_ID, username, ADMIN_USERNAME, salt, hash, ADMIN_PASSWORD_ITERATIONS, now, now)
    .run();

  await purgeSocialRowsBestEffort(db, ADMIN_ID);
  return { configured: true, created: true, userId: ADMIN_ID };
}

async function purgeSocialRowsBestEffort(db, adminId) {
  const statements = [
    db.prepare("DELETE FROM friend_requests WHERE requester_id = ? OR receiver_id = ?").bind(adminId, adminId),
    db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").bind(adminId, adminId),
    db.prepare("DELETE FROM activity_events WHERE user_id = ?").bind(adminId),
  ];
  for (const statement of statements) {
    try {
      await statement.run();
    } catch {
      // Social cleanup must never block Admin authentication.
    }
  }
}

async function deriveHash(secret, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
