import { PASSWORD_ITERATIONS, derivePasswordHash, constantTimeEqual, decodeBase64Url } from '../_password.js';

export async function onRequestPost(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: 'D1_NOT_CONFIGURED' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'BAD_ORIGIN' }, 403);
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.normalize('NFKC').trim().toLowerCase() : '';
    const code = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
    const password = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!username || code.length < 20 || code.length > 128) return invalid();
    if (password.length < 12 || password.length > 128) return json({ error: 'WEAK_PASSWORD', message: 'كلمة المرور الجديدة لازم تكون 12 حرفًا أو أكثر.' }, 400);
    const user = await db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1').bind(username).first();
    if (!user) return invalid();
    const result = await db.prepare(`SELECT scheme, recovery_salt, recovery_hash, recovery_iterations
      FROM user_recovery_verifiers WHERE user_id = ?`).bind(user.id).all();
    let matched = null;
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
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const hash = await derivePasswordHash(password, saltBytes, PASSWORD_ITERATIONS);
    // Recheck the verifier inside the atomic batch to prevent replay/racing resets.
    const changed = await db.batch([
      db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM user_recovery_verifiers
          WHERE user_id = ? AND scheme = ? AND recovery_salt = ? AND recovery_hash = ? AND recovery_iterations = ?)`)
        .bind(salt, hash, PASSWORD_ITERATIONS, Date.now(), user.id, user.id, matched.scheme, matched.recovery_salt, matched.recovery_hash, matched.recovery_iterations),
      db.prepare('DELETE FROM user_recovery_verifiers WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM account_recovery WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM user_password_verifiers WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(user.id, user.id, hash),
    ]);
    if (Number(changed[0]?.meta?.changes) !== 1) return invalid();
    return json({ ok: true });
  } catch (error) {
    console.error('Wany recovery failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'SERVER_ERROR', message: 'تعذر استعادة الحساب الآن.' }, 500);
  }
}
async function invalid() {
  await new Promise(resolve => setTimeout(resolve, 120));
  return json({ error: 'INVALID_RECOVERY', message: 'اسم المستخدم أو رمز الاستعادة غير صحيح.' }, 401);
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
