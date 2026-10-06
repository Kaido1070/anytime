export const USER_ID_DIGITS = 32;

// Decimal TEXT, never a JavaScript Number or a SQLite INTEGER.
// Rejection sampling avoids modulo bias. Leading zero is excluded.
export function randomNumericUserId() {
  let id = '';
  while (id.length < USER_ID_DIGITS) {
    for (const byte of crypto.getRandomValues(new Uint8Array(48))) {
      if (byte >= 250) continue;
      const digit = String(byte % 10);
      if (!id && digit === '0') continue;
      id += digit;
      if (id.length === USER_ID_DIGITS) break;
    }
  }
  return id;
}

export function isNumericUserId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{31}$/.test(value);
}

export async function allocateNumericUserId(db) {
  // INSERT must still enforce users.id uniqueness and retry on a collision.
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = randomNumericUserId();
    const existing = await db.prepare(`SELECT id FROM users WHERE id = ?
      UNION ALL SELECT old_user_id AS id FROM user_identity_aliases WHERE old_user_id = ? LIMIT 1`)
      .bind(id, id).first();
    if (!existing) return id;
  }
  throw new Error('Could not allocate a unique user ID.');
}

export function snapshotCoverKey(userId, mangaId) {
  return `covers/${encodeURIComponent(String(userId))}/${encodeURIComponent(String(mangaId))}`;
}

export async function snapshotCoverKeys(db, userId, mangaId) {
  const preferred = await db.prepare(`SELECT r2_user_id FROM work_snapshot_cover_locations
    WHERE user_id = ? AND manga_id = ? LIMIT 1`).bind(userId, mangaId).first();
  const aliases = await db.prepare(`SELECT old_user_id FROM user_identity_aliases
    WHERE user_id = ? ORDER BY old_user_id`).bind(userId).all();
  return [...new Set([userId, preferred?.r2_user_id, ...(aliases.results ?? []).map(r => r.old_user_id)]
    .filter(Boolean).map(id => snapshotCoverKey(id, mangaId)))];
}
