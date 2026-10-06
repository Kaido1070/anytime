import { mutationOriginError, readAuthJson, reserveAuthAttempt, rateLimited, authError } from "../../_auth-security.js";
import { verifyPassword, derivePasswordHash, PASSWORD_ITERATIONS } from "../../_password.js";
import {
  ensureAdminSchema,
  isAdminUser,
  publicUser,
  recordAdminAudit,
  sessionUser,
} from "../../_admin.js";

const SESSION_COOKIE = "anytime_session";

export async function onRequest(context) {
  const { request } = context;
  const db = context.env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  try {
    const originError = mutationOriginError(request);
    if (originError) return originError;
    await ensureAdminSchema(db);
    const session = await getSession(request, db);
    if (!session) return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
    if (!isAdminUser(session.user)) {
      return json({ error: "ADMIN_REQUIRED", message: "هذه المنطقة مخصصة للإدارة." }, 403);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/admin\/?/, "");

    const securityMatch = path.match(/^users\/([^/]+)\/(security-question|reset-password)$/);
    if (securityMatch) {
      const targetId = safeId(decodeURIComponent(securityMatch[1]));
      if (!targetId) return json({ error: "INVALID_USER" }, 400);
      const target = await db.prepare("SELECT id, password_hash FROM users WHERE id = ? AND role = 'user'").bind(targetId).first();
      if (!target) return json({ error: "USER_NOT_FOUND" }, 404);
      if (securityMatch[2] === "security-question" && request.method === "GET") {
        const row = await db.prepare("SELECT question FROM user_security_questions WHERE user_id = ?").bind(targetId).first();
        const lock = await db.prepare("SELECT failures FROM user_security_question_locks WHERE user_id = ?").bind(targetId).first();
        return json({ question: row?.question ?? null, recoveryLocked: Number(lock?.failures) >= 5, failedAnswers: Number(lock?.failures ?? 0) });
      }
      if (securityMatch[2] === "reset-password" && request.method === "POST") {
        const body = await readAuthJson(request);
        const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
        const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
        if (newPassword.length < 6 || newPassword.length > 128) return json({ error: "INVALID_PASSWORD", message: "كلمة المرور الجديدة يجب أن تكون بين 6 و128 حرفًا." }, 400);
        if (!(await reserveAuthAttempt(db, request, "password-change", session.user.id))) return rateLimited();
        const admin = await db.prepare("SELECT password_salt, password_hash, password_iterations FROM users WHERE id = ? AND role = 'admin'").bind(session.user.id).first();
        if (!currentPassword || currentPassword.length > 128 || !admin || !(await verifyPassword(currentPassword, admin))) return json({ error: "WRONG_PASSWORD", message: "كلمة مرور الأدمن غير صحيحة." }, 400);
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const salt = bytesToBase64Url(saltBytes);
        const hash = await derivePasswordHash(newPassword, saltBytes, PASSWORD_ITERATIONS);
        const now = Date.now();
        const results = await db.batch([
          db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ?
            WHERE id = ? AND role = 'user' AND password_hash = ? AND EXISTS
            (SELECT 1 FROM users a JOIN sessions s ON s.user_id = a.id WHERE a.id = ? AND a.role = 'admin' AND a.password_hash = ? AND s.token_hash = ? AND s.expires_at > ?)`)
            .bind(salt, hash, PASSWORD_ITERATIONS, now, targetId, target.password_hash, session.user.id, admin.password_hash, session.tokenHash, now),
          ...["sessions", "user_password_verifiers", "user_recovery_verifiers", "account_recovery", "user_security_question_locks"].map(table => db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`).bind(targetId, targetId, hash)),
          db.prepare(`INSERT INTO admin_credential_events (admin_user_id, target_user_id, created_at)
            SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ?`).bind(session.user.id, now, targetId, hash),
        ]);
        if (Number(results[0]?.meta?.changes) !== 1) return json({ error: "UNAUTHORIZED" }, 401);
        return json({ ok: true });
      }
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    if (path === "users") {
      return json(await getAdminUsers(db, url));
    }

    const userMatch = path.match(/^users\/([^/]+)$/);
    if (userMatch) {
      const targetId = safeId(decodeURIComponent(userMatch[1]));
      if (!targetId) return json({ error: "INVALID_USER" }, 400);
      const detail = await getAdminUserDetail(db, session.user, targetId, url);
      if (!detail) return json({ error: "USER_NOT_FOUND", message: "الحساب غير موجود." }, 404);
      return json({ detail });
    }

    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    console.error("Anytime admin API error", error?.name ?? "Error");
    const safeError = authError(error);
    if (safeError) return safeError;
    if (error?.code === "INVALID_JSON" || error?.code === "BODY_TOO_LARGE") return json({ error: error.code }, error.code === "BODY_TOO_LARGE" ? 413 : 400);
    if (error?.code === "SCHEMA_MIGRATION_REQUIRED") return json({ error: error.code }, 503);
    return json({ error: "SERVER_ERROR", message: "تعذر تحميل بيانات الإدارة الآن." }, 500);
  }
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const row = await db
    .prepare(`SELECT s.token_hash, s.expires_at, u.id, u.username, u.name,
      u.profile_visibility, u.avatar_id, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
      LIMIT 1`)
    .bind(tokenHash, now)
    .first();
  if (!row) return null;
  return { tokenHash, user: sessionUser(row) };
}

async function getAdminUsers(db, url) {
  const query = normalizeSearch(url.searchParams.get("q"));
  const visibility = url.searchParams.get("visibility");
  const status = url.searchParams.get("status");
  const sort = url.searchParams.get("sort");
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;

  const conditions = ["u.role = 'user'"];
  const args = [];
  if (visibility === "public" || visibility === "private") {
    conditions.push("u.profile_visibility = ?");
    args.push(visibility);
  }
  if (query) {
    conditions.push("(u.username LIKE ? ESCAPE '\\' COLLATE NOCASE OR u.name LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    const contains = `%${escapeSqlLike(query)}%`;
    args.push(contains, contains);
  }
  if (status === "reading") {
    conditions.push("EXISTS (SELECT 1 FROM user_library filter_library WHERE filter_library.user_id = u.id AND filter_library.status = 'reading')");
  }

  const where = conditions.join(" AND ");
  const orderBy =
    sort === "username"
      ? "u.username COLLATE NOCASE ASC, u.id ASC"
      : sort === "works"
        ? "works_count DESC, u.username COLLATE NOCASE ASC"
        : sort === "chapters"
          ? "chapters_read_count DESC, u.username COLLATE NOCASE ASC"
          : "last_activity_at DESC, u.username COLLATE NOCASE ASC";

  const [countRow, result] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`).bind(...args).first(),
    db.prepare(`SELECT
      u.id, u.username, u.name, u.profile_visibility, u.avatar_id,
      (SELECT COUNT(*) FROM user_library ul WHERE ul.user_id = u.id) AS works_count,
      (SELECT COUNT(*) FROM (
        SELECT manga_id, chapter
        FROM reading_history rh
        WHERE rh.user_id = u.id
        GROUP BY manga_id, chapter
      )) AS chapters_read_count,
      (SELECT COUNT(*) FROM user_lists l WHERE l.user_id = u.id) AS lists_count,
      (SELECT COUNT(*)
        FROM friendships f
        JOIN users friend_user ON friend_user.id = f.friend_id AND friend_user.role = 'user'
        WHERE f.user_id = u.id) AS friends_count,
      MAX(
        COALESCE((SELECT MAX(e.updated_at) FROM activity_events e WHERE e.user_id = u.id), 0),
        COALESCE((SELECT MAX(COALESCE(ul2.last_read_at, ul2.updated_at)) FROM user_library ul2 WHERE ul2.user_id = u.id), 0),
        u.updated_at
      ) AS last_activity_at,
      (SELECT ul3.manga_id FROM user_library ul3
        WHERE ul3.user_id = u.id AND ul3.last_read_at IS NOT NULL
        ORDER BY ul3.last_read_at DESC, ul3.updated_at DESC, ul3.manga_id ASC LIMIT 1) AS last_manga_id,
      (SELECT ul4.last_read_chapter FROM user_library ul4
        WHERE ul4.user_id = u.id AND ul4.last_read_at IS NOT NULL
        ORDER BY ul4.last_read_at DESC, ul4.updated_at DESC, ul4.manga_id ASC LIMIT 1) AS last_read_chapter,
      (SELECT ul5.highest_reached_chapter FROM user_library ul5
        WHERE ul5.user_id = u.id AND ul5.last_read_at IS NOT NULL
        ORDER BY ul5.last_read_at DESC, ul5.updated_at DESC, ul5.manga_id ASC LIMIT 1) AS highest_reached_chapter,
      (SELECT ul6.last_read_at FROM user_library ul6
        WHERE ul6.user_id = u.id AND ul6.last_read_at IS NOT NULL
        ORDER BY ul6.last_read_at DESC, ul6.updated_at DESC, ul6.manga_id ASC LIMIT 1) AS last_read_at
      FROM users u
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset)
      .all(),
  ]);

  const rows = result.results ?? [];
  const total = Number(countRow?.total ?? 0);
  return {
    users: rows.map((row) => ({
      user: publicUser(row),
      worksCount: Number(row.works_count ?? 0),
      chaptersReadCount: Number(row.chapters_read_count ?? 0),
      listsCount: Number(row.lists_count ?? 0),
      friendsCount: Number(row.friends_count ?? 0),
      lastActivityAt: row.last_activity_at ? Number(row.last_activity_at) : null,
      lastRead: row.last_manga_id ? {
        mangaId: row.last_manga_id,
        lastReadChapter: numberOrNull(row.last_read_chapter),
        highestReachedChapter: numberOrNull(row.highest_reached_chapter),
        lastReadAt: numberOrNull(row.last_read_at),
      } : null,
    })),
    total,
    hasMore: offset + rows.length < total,
  };
}

async function getAdminUserDetail(db, adminUser, targetId, url) {
  const target = await db
    .prepare("SELECT id, username, name, profile_visibility, avatar_id, created_at FROM users WHERE id = ? AND role = 'user' LIMIT 1")
    .bind(targetId)
    .first();
  if (!target) return null;

  const requestedHistoryLimit = Number(url.searchParams.get("historyLimit") ?? 50);
  const requestedHistoryOffset = Number(url.searchParams.get("historyOffset") ?? 0);
  const historyLimit = Number.isFinite(requestedHistoryLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedHistoryLimit))) : 50;
  const historyOffset = Number.isFinite(requestedHistoryOffset) ? Math.max(0, Math.trunc(requestedHistoryOffset)) : 0;

  const [
    libraryResult,
    historyCount,
    historyResult,
    listResult,
    listItemsResult,
    favoritesResult,
    friendsResult,
    activityResult,
  ] = await Promise.all([
    db.prepare(`SELECT manga_id, status, added_at, updated_at, last_read_at,
      last_read_chapter, highest_reached_chapter
      FROM user_library WHERE user_id = ?
      ORDER BY COALESCE(last_read_at, updated_at) DESC, updated_at DESC, manga_id ASC`)
      .bind(targetId).all(),
    db.prepare("SELECT COUNT(*) AS total FROM reading_history WHERE user_id = ?").bind(targetId).first(),
    db.prepare(`SELECT id, manga_id, chapter, read_at
      FROM reading_history WHERE user_id = ?
      ORDER BY read_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(targetId, historyLimit, historyOffset).all(),
    db.prepare(`SELECT l.id, l.name, l.description, l.position, l.created_at, l.updated_at,
      COUNT(i.manga_id) AS item_count
      FROM user_lists l
      LEFT JOIN user_list_items i ON i.list_id = l.id
      WHERE l.user_id = ?
      GROUP BY l.id
      ORDER BY l.position ASC, l.created_at ASC, l.id ASC`)
      .bind(targetId).all(),
    db.prepare(`SELECT i.list_id, i.manga_id, i.position, i.added_at
      FROM user_list_items i
      JOIN user_lists l ON l.id = i.list_id
      WHERE l.user_id = ?
      ORDER BY i.list_id ASC, i.position ASC, i.added_at ASC, i.manga_id ASC`)
      .bind(targetId).all(),
    db.prepare("SELECT manga_id FROM favorites WHERE user_id = ? ORDER BY created_at ASC, manga_id ASC")
      .bind(targetId).all(),
    db.prepare(`SELECT u.id, u.username, u.name, u.profile_visibility, u.avatar_id
      FROM friendships f
      JOIN users u ON u.id = f.friend_id AND u.role = 'user'
      WHERE f.user_id = ?
      ORDER BY u.name COLLATE NOCASE ASC, u.id ASC`)
      .bind(targetId).all(),
    db.prepare(`SELECT e.id, e.type, e.manga_id, e.list_id, e.chapter_number,
      e.created_at, e.updated_at, l.name AS list_name
      FROM activity_events e
      LEFT JOIN user_lists l ON l.id = e.list_id
      WHERE e.user_id = ? AND (e.list_id IS NULL OR l.id IS NOT NULL)
      ORDER BY e.created_at DESC, e.id DESC LIMIT 100`)
      .bind(targetId).all(),
  ]);

  const listItems = new Map();
  for (const row of listItemsResult.results ?? []) {
    const items = listItems.get(row.list_id) ?? [];
    items.push({
      mangaId: row.manga_id,
      position: Number(row.position),
      addedAt: Number(row.added_at),
    });
    listItems.set(row.list_id, items);
  }

  const library = (libraryResult.results ?? []).map((row) => ({
    mangaId: row.manga_id,
    status: row.status,
    addedAt: Number(row.added_at),
    updatedAt: Number(row.updated_at),
    lastReadAt: numberOrNull(row.last_read_at),
    lastReadChapter: numberOrNull(row.last_read_chapter),
    highestReachedChapter: numberOrNull(row.highest_reached_chapter),
  }));

  const lists = (listResult.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    position: Number(row.position),
    itemCount: Number(row.item_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    items: listItems.get(row.id) ?? [],
  }));

  const activity = (activityResult.results ?? []).map((row) => ({
    id: Number(row.id),
    type: row.type,
    user: publicUser(target),
    mangaId: row.manga_id ?? null,
    list: row.list_id && row.list_name ? { id: row.list_id, name: row.list_name } : null,
    chapterNumber: numberOrNull(row.chapter_number),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));

  const historyRows = historyResult.results ?? [];
  const historyTotal = Number(historyCount?.total ?? 0);
  const latestLibraryActivity = library.reduce(
    (latest, item) => Math.max(latest, item.lastReadAt ?? item.updatedAt ?? 0),
    0,
  );
  const latestEventActivity = activity.reduce((latest, item) => Math.max(latest, item.updatedAt), 0);

  if (target.profile_visibility === "private") {
    await recordAdminAudit(db, adminUser.id, "view_private_user", target.id);
  }

  return {
    user: publicUser(target),
    createdAt: Number(target.created_at),
    lastActivityAt: Math.max(latestLibraryActivity, latestEventActivity) || null,
    stats: {
      works: library.length,
      lists: lists.length,
      friends: (friendsResult.results ?? []).length,
    },
    library,
    readingHistory: historyRows.map((row) => ({
      id: Number(row.id),
      mangaId: row.manga_id,
      chapter: Number(row.chapter),
      readAt: Number(row.read_at),
    })),
    readingHistoryTotal: historyTotal,
    readingHistoryHasMore: historyOffset + historyRows.length < historyTotal,
    lists,
    favorites: (favoritesResult.results ?? []).map((row) => row.manga_id),
    friends: (friendsResult.results ?? []).map(publicUser),
    activity,
  };
}

function normalizeSearch(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
}

function escapeSqlLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function safeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(normalized) ? normalized : "";
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
