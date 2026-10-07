import { normalizeLoginName, readAuthJson, reserveAuthAttempt, rateLimited } from "./_auth-security.js";
import { allocateNumericUserId } from "./_identity.js";
import { PASSWORD_ITERATIONS, derivePasswordHash } from "./_password.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

const invalidInvite = () => json({ error: "INVALID_INVITE", message: "كود الدعوة غير صالح أو انتهى استخدامه." }, 403);

export async function registerWithInvite(request, db) {
  const body = await readAuthJson(request);
  const username = normalizeLoginName(body.username);
  if (!(await reserveAuthAttempt(db, request, "registration", username))) return rateLimited();
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  if (!/^[a-z0-9][a-z0-9_]{2,31}$/.test(username) || password.length < 8 || password.length > 128) {
    return json({ error: "INVALID_REGISTRATION", message: "اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو _، وكلمة المرور من 8 إلى 128 حرفًا." }, 400);
  }
  if (code.length < 8 || code.length > 128) return invalidInvite();
  const tables = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('registration_invites', 'registration_invite_claims')`).all();
  if ((tables.results ?? []).length !== 2) {
    return json({ error: "REGISTRATION_CLOSED", message: "إنشاء الحسابات غير متاح حاليًا." }, 503);
  }
  const now = Date.now();
  const validInvite = `SELECT code FROM registration_invites i WHERE code = ? AND enabled = 1
    AND (expires_at IS NULL OR expires_at > ?)
    AND (SELECT COUNT(*) FROM registration_invite_claims c WHERE c.code = i.code) < max_uses`;
  if (!(await db.prepare(validInvite).bind(code, now).first())) return invalidInvite();
  if (await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first()) {
    return json({ error: "USERNAME_TAKEN", message: "اسم المستخدم مستخدم بالفعل." }, 409);
  }
  const id = await allocateNumericUserId(db);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = btoa(String.fromCharCode(...saltBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const hash = await derivePasswordHash(password, saltBytes, PASSWORD_ITERATIONS);
  // D1 batch is transactional: validation, account creation and invitation
  // consumption succeed together. A racing claimant cannot exceed max_uses.
  const claimedAt = Date.now();
  let results;
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO users
        (id, username, name, password_salt, password_hash, password_iterations, role, profile_visibility, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, 'user', 'private', ?, ? WHERE EXISTS (${validInvite})`)
        .bind(id, username, username, salt, hash, PASSWORD_ITERATIONS, claimedAt, claimedAt, code, claimedAt),
      db.prepare(`INSERT INTO registration_invite_claims (code, user_id, created_at)
        SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ?`)
        .bind(code, claimedAt, id, hash),
      ...["continue_reading", "favorites", "my_activity", "friends_activity"].map((section, index) =>
        db.prepare(`INSERT INTO user_profile_sections
          (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
          SELECT id, ?, '', ?, 1, ?, ? FROM users WHERE id = ? AND password_hash = ?`)
          .bind(section, (index + 1) * 1024, claimedAt, claimedAt, id, hash)),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed: users.username/i.test(String(error?.message))) {
      return json({ error: "USERNAME_TAKEN", message: "اسم المستخدم مستخدم بالفعل." }, 409);
    }
    throw error;
  }
  if (Number(results[0]?.meta?.changes) !== 1) return invalidInvite();
  return json({ ok: true }, 201);
}
