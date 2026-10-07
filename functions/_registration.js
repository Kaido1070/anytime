import { normalizeLoginName, readAuthJson, reserveAuthAttempt, rateLimited } from "./_auth-security.js";
import { allocateNumericUserId } from "./_identity.js";
import { PASSWORD_ITERATIONS, derivePasswordHash } from "./_password.js";
import { normalizeSecurityAnswer, createSecurityAnswer } from "./_security-question.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function registerAccount(request, db) {
  const body = await readAuthJson(request);
  const username = normalizeLoginName(body.username);
  if (!(await reserveAuthAttempt(db, request, "registration", username))) return rateLimited();

  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const securityQuestion = typeof body.securityQuestion === "string" ? body.securityQuestion.trim() : "";
  const securityAnswer = normalizeSecurityAnswer(body.securityAnswer);

  if (!/^[a-z0-9][a-z0-9_]{2,31}$/.test(username) || password.length < 8 || password.length > 128) {
    return json({ error: "INVALID_REGISTRATION", message: "اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو _، وكلمة المرور من 8 إلى 128 حرفًا." }, 400);
  }
  if (confirmPassword !== password) {
    return json({ error: "PASSWORD_MISMATCH", message: "تأكيد كلمة المرور غير مطابق." }, 400);
  }
  if (securityQuestion.length < 6 || securityQuestion.length > 200 || /[\u0000-\u001f\u007f]/.test(securityQuestion) || securityAnswer.length < 1 || securityAnswer.length > 128) {
    return json({ error: "INVALID_SECURITY_QUESTION", message: "اكتب سؤال أمان من 6 أحرف أو أكثر وإجابة غير فارغة." }, 400);
  }

  if (await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first()) {
    return json({ error: "USERNAME_TAKEN", message: "اسم المستخدم مستخدم بالفعل." }, 409);
  }

  const id = await allocateNumericUserId(db);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = btoa(String.fromCharCode(...saltBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const hash = await derivePasswordHash(password, saltBytes, PASSWORD_ITERATIONS);
  const answerCredential = await createSecurityAnswer(securityAnswer);
  const createdAt = Date.now();

  let results;
  try {
    results = await db.batch([
      db.prepare("INSERT INTO users (id, username, name, password_salt, password_hash, password_iterations, role, profile_visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'user', 'private', ?, ?)")
        .bind(id, username, username, salt, hash, PASSWORD_ITERATIONS, createdAt, createdAt),
      db.prepare("INSERT INTO user_security_questions (user_id, question, answer_salt, answer_hash, answer_iterations, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, securityQuestion, answerCredential.salt, answerCredential.hash, answerCredential.iterations, createdAt),
      ...["continue_reading", "favorites", "my_activity", "friends_activity"].map((section, index) =>
        db.prepare("INSERT INTO user_profile_sections (user_id, section_type, reference_id, position, is_visible, created_at, updated_at) VALUES (?, ?, '', ?, 1, ?, ?)")
          .bind(id, section, (index + 1) * 1024, createdAt, createdAt)),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed: users.username/i.test(String(error?.message))) {
      return json({ error: "USERNAME_TAKEN", message: "اسم المستخدم مستخدم بالفعل." }, 409);
    }
    throw error;
  }

  if (Number(results[0]?.meta?.changes) !== 1 || Number(results[1]?.meta?.changes) !== 1) {
    return json({ error: "REGISTRATION_FAILED", message: "تعذر إنشاء الحساب." }, 500);
  }
  return json({ ok: true }, 201);
}
