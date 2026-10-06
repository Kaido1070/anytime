import { PASSWORD_ITERATIONS, derivePasswordHash, verifyPassword, verifyMissingUser } from './_password.js';

export function normalizeSecurityAnswer(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

export async function createSecurityAnswer(answer) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
    hash: await derivePasswordHash(normalizeSecurityAnswer(answer), bytes, PASSWORD_ITERATIONS),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifySecurityAnswer(answer, row) {
  const normalized = normalizeSecurityAnswer(answer);
  if (!row) return verifyMissingUser(normalized);
  return verifyPassword(normalized, { password_salt: row.answer_salt, password_hash: row.answer_hash, password_iterations: row.answer_iterations });
}
