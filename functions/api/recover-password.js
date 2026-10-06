import { PASSWORD_ITERATIONS, derivePasswordHash, constantTimeEqual, decodeBase64Url } from '../_password.js';
import { normalizeSecurityAnswer, verifySecurityAnswer } from '../_security-question.js';
import { mutationOriginError, readAuthJson, normalizeLoginName, reserveAuthAttempt, rateLimited, authError } from '../_auth-security.js';

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: 'D1_NOT_CONFIGURED' }, 503);
  const originError = mutationOriginError(request);
  if (originError) return originError;
  try {
    const body = await readAuthJson(request);
    const username = normalizeLoginName(body.username);
    const code = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
    const password = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!(await reserveAuthAttempt(db, request, 'recovery', username))) return rateLimited();
    if (!username) return invalid();
    if (body.action === 'question') {
      const row = await db.prepare(`SELECT q.question FROM user_security_questions q
        JOIN users u ON u.id = q.user_id WHERE u.username = ? COLLATE NOCASE LIMIT 1`).bind(username).first();
      return json({ question: row?.question ?? 'ما سؤال الأمان الذي حفظته في إعدادات حسابك؟' });
    }
    const byQuestion = body.method === 'security-question';
    const answer = normalizeSecurityAnswer(body.answer);
    if (byQuestion ? answer.length < 1 || answer.length > 128 : code.length < 20 || code.length > 128) return invalid();
    if (password.length < 6 || password.length > 128) return json({ error: 'WEAK_PASSWORD', message: 'كلمة المرور الجديدة لازم تكون 6 أحرف أو أكثر.' }, 400);
    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE LIMIT 1').bind(username).first();
    let matched = null;
    let condition;
    let conditionArgs;
    if (byQuestion) {
      const question = user ? await db.prepare('SELECT question, answer_salt, answer_hash, answer_iterations FROM user_security_questions WHERE user_id = ?').bind(user.id).first() : null;
      if (!(await verifySecurityAnswer(answer, question))) return invalid();
      matched = question;
      condition = `EXISTS (SELECT 1 FROM user_security_questions WHERE user_id = ? AND question = ? AND answer_salt = ? AND answer_hash = ? AND answer_iterations = ?)`;
      conditionArgs = [user.id, matched.question, matched.answer_salt, matched.answer_hash, matched.answer_iterations];
    } else {
      if (!user) return invalid();
      const result = await db.prepare(`SELECT scheme, recovery_salt, recovery_hash, recovery_iterations
        FROM user_recovery_verifiers WHERE user_id = ?`).bind(user.id).all();
      let unsupported = false;
      for (const verifier of result.results ?? []) {
        try {
          const actual = verifier.scheme === 'sha256'
            ? new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)))
            : decodeBase64Url(await derivePasswordHash(code, decodeBase64Url(verifier.recovery_salt), Number(verifier.recovery_iterations)));
          if (constantTimeEqual(actual, decodeBase64Url(verifier.recovery_hash))) { matched = verifier; break; }
        } catch (error) {
          if (error?.name !== 'NotSupportedError' && !String(error?.message).includes('iteration counts above')) throw error;
          unsupported = true;
        }
      }
      if (!matched) {
        if (unsupported) return json({ error: 'CREDENTIAL_RUNTIME_UNSUPPORTED' }, 503);
        return invalid();
      }
      condition = `EXISTS (SELECT 1 FROM user_recovery_verifiers WHERE user_id = ? AND scheme = ? AND recovery_salt = ? AND recovery_hash = ? AND recovery_iterations = ?)`;
      conditionArgs = [user.id, matched.scheme, matched.recovery_salt, matched.recovery_hash, matched.recovery_iterations];
    }
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const hash = await derivePasswordHash(password, saltBytes, PASSWORD_ITERATIONS);
    // Guard both the verified recovery factor and the credential generation in the atomic reset.
    const changed = await db.batch([
      db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ?
        WHERE id = ? AND password_hash = ? AND ${condition}`)
        .bind(salt, hash, PASSWORD_ITERATIONS, Date.now(), user.id, user.password_hash, ...conditionArgs),
      db.prepare('DELETE FROM user_recovery_verifiers WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM account_recovery WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM user_password_verifiers WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
    ]);
    if (Number(changed[0]?.meta?.changes) !== 1) return invalid();
    return json({ ok: true });
  } catch (error) {
    console.error('Wany recovery failed', error instanceof Error ? error.name : 'unknown');
    const safeError = authError(error);
    if (safeError) return safeError;
    return json({ error: 'SERVER_ERROR', message: 'تعذر استعادة الحساب الآن.' }, 500);
  }
}
async function invalid() {
  await new Promise(resolve => setTimeout(resolve, 120));
  return json({ error: 'INVALID_RECOVERY', message: 'بيانات الاستعادة غير صحيحة.' }, 401);
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
