const SESSION_COOKIE = "anytime_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210000;
const MAX_JSON_BYTES = 32 * 1024;

const SEEDED_USERS = [
  {
    id: "mahdi",
    username: "mahdi",
    name: "Mahdi",
    salt: "nckWsLoOqPQ2ko0y6KFcdQ",
    hash: "Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE",
  },
  {
    id: "kaido",
    username: "kaido",
    name: "Kaido",
    salt: "w-fi6L0FIdkx0NNSYyhvdg",
    hash: "g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y",
  },
  {
    id: "ahmed",
    username: "ahmed",
    name: "Ahmed",
    salt: "4ueIIy1PaWKbbDjqIkf39g",
    hash: "Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI",
  },
];

const SEEDED_FAVORITES = {
  mahdi: ["returner", "solo"],
  kaido: ["eleceed", "horizon"],
  ahmed: ["solo", "returner"],
};

const SEEDED_PROGRESS = [
  ["mahdi", "returner", 141, 100, 1],
  ["mahdi", "returner", 142, 100, 1],
  ["mahdi", "returner", 143, 62, 0],
  ["kaido", "eleceed", 315, 45, 0],
  ["ahmed", "solo", 197, 55, 0],
];

export async function onRequest(context) {
  const request = context.request;
  const db = context.env?.DB;
  if (!db) {
    return json(
      {
        error: "D1_NOT_CONFIGURED",
        message: "قاعدة بيانات Anytime غير مربوطة بالموقع بعد.",
      },
      503,
    );
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return json({ error: "NOT_FOUND" }, 404);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "BAD_ORIGIN" }, 403);
  }

  try {
    await ensureDatabase(db);
    return await route(request, url, db);
  } catch (error) {
    console.error("Anytime API error", error);
    return json(
      {
        error: "SERVER_ERROR",
        message: "صار خطأ أثناء مزامنة المكتبة. حاول مرة ثانية.",
      },
      500,
    );
  }
}

async function route(request, url, db) {
  const path = url.pathname.replace(/^\/api\/?/, "");

  if (request.method === "GET" && path === "health") {
    return json({ ok: true, phase: 3, database: "ready" });
  }

  if (request.method === "POST" && path === "login") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || password.length < 1 || password.length > 128) {
      return json({ error: "INVALID_LOGIN", message: "بيانات الدخول غير صحيحة." }, 401);
    }

    const user = await db
      .prepare(
        "SELECT id, username, name, password_salt, password_hash, password_iterations FROM users WHERE username = ? LIMIT 1",
      )
      .bind(username)
      .first();

    if (!user || !(await verifyPassword(password, user))) {
      await sleep(120);
      return json({ error: "INVALID_LOGIN", message: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
    }

    const token = randomToken(32);
    const tokenHash = await sha256Base64Url(token);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      db
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(tokenHash, user.id, now, now, expiresAt),
    ]);

    return json(
      { user: publicUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, SESSION_TTL_MS) },
    );
  }

  if (request.method === "POST" && path === "logout") {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      const tokenHash = await sha256Base64Url(token);
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    return json(
      { ok: true },
      200,
      { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
    );
  }

  if (request.method === "GET" && path === "session") {
    const session = await getSession(request, db);
    return json({ user: session ? publicUser(session.user) : null });
  }

  const session = await getSession(request, db);
  if (!session) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }
  const user = session.user;

  if (request.method === "GET" && path === "data") {
    return json({ data: await getUserData(db, user.id) });
  }

  if (request.method === "GET" && path === "lists") {
    return json({ lists: await getUserLists(db, user.id) });
  }

  if (request.method === "POST" && path === "lists") {
    const body = await readJson(request);
    const input = normalizeListInput(body);
    if (!input) {
      return json(
        { error: "INVALID_LIST", message: "اسم القائمة مطلوب وبحد أقصى 80 حرفًا." },
        400,
      );
    }
    const last = await db
      .prepare("SELECT MAX(position) AS position FROM user_lists WHERE user_id = ?")
      .bind(user.id)
      .first();
    const now = Date.now();
    const list = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      position: Number(last?.position ?? 0) + 1024,
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .prepare(
        `INSERT INTO user_lists
          (id, user_id, name, description, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        list.id,
        user.id,
        list.name,
        list.description,
        list.position,
        list.createdAt,
        list.updatedAt,
      )
      .run();
    return json({ list }, 201);
  }

  const membershipMatch = path.match(/^lists\/membership\/(.+)$/);
  if (request.method === "GET" && membershipMatch) {
    const mangaId = safeId(decodeURIComponent(membershipMatch[1]));
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    const result = await db
      .prepare(
        `SELECT i.list_id
         FROM user_list_items i
         JOIN user_lists l ON l.id = i.list_id
         WHERE l.user_id = ? AND i.manga_id = ?
         ORDER BY l.position ASC, l.created_at ASC`,
      )
      .bind(user.id, mangaId)
      .all();
    return json({ listIds: (result.results ?? []).map((row) => row.list_id) });
  }

  const listReorderMatch = path.match(/^lists\/([^/]+)\/reorder$/);
  if (request.method === "PUT" && listReorderMatch) {
    const listId = safeId(decodeURIComponent(listReorderMatch[1]));
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const beforeId = body.beforeId == null ? "" : safeId(body.beforeId);
    const afterId = body.afterId == null ? "" : safeId(body.afterId);
    if (!listId || !mangaId || (body.beforeId != null && !beforeId) || (body.afterId != null && !afterId)) {
      return json({ error: "INVALID_REORDER" }, 400);
    }
    const result = await reorderUserListItem(
      db,
      user.id,
      listId,
      mangaId,
      beforeId || null,
      afterId || null,
    );
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true });
  }

  const listItemsMatch = path.match(/^lists\/([^/]+)\/items(?:\/(.+))?$/);
  if (listItemsMatch) {
    const listId = safeId(decodeURIComponent(listItemsMatch[1]));
    if (!listId) return json({ error: "INVALID_LIST" }, 400);
    const owned = await db
      .prepare("SELECT id FROM user_lists WHERE id = ? AND user_id = ? LIMIT 1")
      .bind(listId, user.id)
      .first();
    if (!owned) return json({ error: "LIST_NOT_FOUND" }, 404);

    if (request.method === "POST" && !listItemsMatch[2]) {
      const body = await readJson(request);
      const mangaId = safeId(body.mangaId);
      if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
      const last = await db
        .prepare("SELECT MAX(position) AS position FROM user_list_items WHERE list_id = ?")
        .bind(listId)
        .first();
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO user_list_items
              (list_id, manga_id, position, added_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(listId, mangaId, Number(last?.position ?? 0) + 1024, now),
        db.prepare("UPDATE user_lists SET updated_at = ? WHERE id = ? AND user_id = ?")
          .bind(now, listId, user.id),
      ]);
      return json({ ok: true }, 201);
    }

    if (request.method === "DELETE" && listItemsMatch[2]) {
      const mangaId = safeId(decodeURIComponent(listItemsMatch[2]));
      if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
      const now = Date.now();
      await db.batch([
        db.prepare("DELETE FROM user_list_items WHERE list_id = ? AND manga_id = ?")
          .bind(listId, mangaId),
        db.prepare("UPDATE user_lists SET updated_at = ? WHERE id = ? AND user_id = ?")
          .bind(now, listId, user.id),
      ]);
      return json({ ok: true });
    }
  }

  const listMatch = path.match(/^lists\/([^/]+)$/);
  if (listMatch) {
    const listId = safeId(decodeURIComponent(listMatch[1]));
    if (!listId) return json({ error: "INVALID_LIST" }, 400);

    if (request.method === "GET") {
      const listRow = await db
        .prepare(
          `SELECT id, name, description, position, created_at, updated_at
           FROM user_lists
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
        )
        .bind(listId, user.id)
        .first();
      if (!listRow) return json({ error: "LIST_NOT_FOUND" }, 404);
      const itemResult = await db
        .prepare(
          `SELECT manga_id, position, added_at
           FROM user_list_items
           WHERE list_id = ?
           ORDER BY position ASC, added_at ASC, manga_id ASC`,
        )
        .bind(listId)
        .all();
      const items = (itemResult.results ?? []).map((row) => ({
        mangaId: row.manga_id,
        position: Number(row.position),
        addedAt: Number(row.added_at),
      }));
      return json({
        list: {
          ...mapUserList(listRow),
          itemCount: items.length,
        },
        items,
      });
    }

    if (request.method === "PUT") {
      const body = await readJson(request);
      const input = normalizeListInput(body);
      if (!input) {
        return json(
          { error: "INVALID_LIST", message: "اسم القائمة مطلوب وبحد أقصى 80 حرفًا." },
          400,
        );
      }
      const now = Date.now();
      const result = await db
        .prepare(
          `UPDATE user_lists
           SET name = ?, description = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(input.name, input.description, now, listId, user.id)
        .run();
      if (!result.meta?.changes) return json({ error: "LIST_NOT_FOUND" }, 404);
      const updated = await db
        .prepare(
          `SELECT
             l.id, l.name, l.description, l.position, l.created_at, l.updated_at,
             COUNT(i.manga_id) AS item_count
           FROM user_lists l
           LEFT JOIN user_list_items i ON i.list_id = l.id
           WHERE l.id = ? AND l.user_id = ?
           GROUP BY l.id`,
        )
        .bind(listId, user.id)
        .first();
      return json({ list: mapUserList(updated) });
    }

    if (request.method === "DELETE") {
      const result = await db
        .prepare("DELETE FROM user_lists WHERE id = ? AND user_id = ?")
        .bind(listId, user.id)
        .run();
      if (!result.meta?.changes) return json({ error: "LIST_NOT_FOUND" }, 404);
      return json({ ok: true });
    }
  }

  if (request.method === "GET" && path === "library") {
    const data = await getUserData(db, user.id);
    return json({ library: data.library });
  }

  if (request.method === "POST" && path === "library") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const status = libraryStatus(body.status) || "planned";
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    const now = Date.now();
    await db
      .prepare(`INSERT INTO user_library
        (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
        ON CONFLICT(user_id, manga_id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at`)
      .bind(user.id, mangaId, status, now, now)
      .run();
    return json({ ok: true }, 201);
  }

  if (request.method === "PUT" && path === "library") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const status = libraryStatus(body.status);
    if (!mangaId || !status) return json({ error: "INVALID_LIBRARY_ITEM" }, 400);
    const result = await db
      .prepare("UPDATE user_library SET status = ?, updated_at = ? WHERE user_id = ? AND manga_id = ?")
      .bind(status, Date.now(), user.id, mangaId)
      .run();
    if (!result.meta?.changes) return json({ error: "LIBRARY_ITEM_NOT_FOUND" }, 404);
    return json({ ok: true });
  }

  const libraryMatch = path.match(/^library\/([^/]+)$/);
  if (request.method === "DELETE" && libraryMatch) {
    const mangaId = safeId(decodeURIComponent(libraryMatch[1]));
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    await db
      .prepare("DELETE FROM user_library WHERE user_id = ? AND manga_id = ?")
      .bind(user.id, mangaId)
      .run();
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "reading/open") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const chapter = Number(body.chapter);
    if (!mangaId || !Number.isFinite(chapter) || chapter < 0) {
      return json({ error: "INVALID_READING_EVENT" }, 400);
    }
    const now = Date.now();
    await db.batch([
      db
        .prepare("INSERT INTO reading_history (user_id, manga_id, chapter, read_at) VALUES (?, ?, ?, ?)")
        .bind(user.id, mangaId, chapter, now),
      db
        .prepare(`INSERT INTO user_library
          (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
          VALUES (?, ?, 'reading', ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, manga_id) DO UPDATE SET
            status = CASE WHEN user_library.status = 'planned' THEN 'reading' ELSE user_library.status END,
            updated_at = excluded.updated_at,
            last_read_at = excluded.last_read_at,
            last_read_chapter = excluded.last_read_chapter,
            highest_reached_chapter = CASE
              WHEN user_library.highest_reached_chapter IS NULL THEN excluded.highest_reached_chapter
              ELSE MAX(user_library.highest_reached_chapter, excluded.highest_reached_chapter)
            END`)
        .bind(user.id, mangaId, now, now, now, chapter, chapter),
      db
        .prepare(`INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            last_manga_id = excluded.last_manga_id,
            last_chapter = excluded.last_chapter,
            updated_at = excluded.updated_at`)
        .bind(user.id, mangaId, chapter, now),
    ]);
    return json({ ok: true, readAt: now });
  }

  if (request.method === "POST" && path === "reading/unread") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const chapter = Number(body.chapter);
    if (!mangaId || !Number.isFinite(chapter) || chapter < 0) {
      return json({ error: "INVALID_READING_EVENT" }, 400);
    }

    await db.batch([
      db.prepare("DELETE FROM reading_history WHERE user_id = ? AND manga_id = ? AND chapter = ?")
        .bind(user.id, mangaId, chapter),
      db.prepare("DELETE FROM reading_progress WHERE user_id = ? AND manga_id = ? AND chapter = ?")
        .bind(user.id, mangaId, chapter),
    ]);

    const [latestForWork, highestForWork, latestOverall] = await Promise.all([
      db.prepare(`SELECT chapter, read_at FROM reading_history
        WHERE user_id = ? AND manga_id = ?
        ORDER BY read_at DESC, id DESC LIMIT 1`).bind(user.id, mangaId).first(),
      db.prepare(`SELECT MAX(chapter) AS chapter FROM reading_history
        WHERE user_id = ? AND manga_id = ?`).bind(user.id, mangaId).first(),
      db.prepare(`SELECT manga_id, chapter, read_at FROM reading_history
        WHERE user_id = ?
        ORDER BY read_at DESC, id DESC LIMIT 1`).bind(user.id).first(),
    ]);

    const now = Date.now();
    await db.batch([
      db.prepare(`UPDATE user_library
        SET updated_at = ?,
            last_read_at = ?,
            last_read_chapter = ?,
            highest_reached_chapter = ?
        WHERE user_id = ? AND manga_id = ?`)
        .bind(
          now,
          latestForWork?.read_at ?? null,
          latestForWork?.chapter ?? null,
          highestForWork?.chapter ?? null,
          user.id,
          mangaId,
        ),
      db.prepare(`INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          last_manga_id = excluded.last_manga_id,
          last_chapter = excluded.last_chapter,
          updated_at = excluded.updated_at`)
        .bind(user.id, latestOverall?.manga_id ?? null, latestOverall?.chapter ?? null, now),
    ]);

    return json({
      ok: true,
      lastReadChapter: latestForWork?.chapter == null ? null : Number(latestForWork.chapter),
      highestReachedChapter:
        highestForWork?.chapter == null ? null : Number(highestForWork.chapter),
    });
  }

  if (request.method === "GET" && path === "reading/history") {
    const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
      : 100;
    const result = await db
      .prepare(`SELECT id, manga_id, chapter, read_at
        FROM reading_history
        WHERE user_id = ?
        ORDER BY read_at DESC, id DESC
        LIMIT ?`)
      .bind(user.id, limit)
      .all();
    return json({
      history: (result.results ?? []).map((row) => ({
        id: Number(row.id),
        mangaId: row.manga_id,
        chapter: Number(row.chapter),
        readAt: Number(row.read_at),
      })),
    });
  }

  if (request.method === "POST" && path === "favorites") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    await db
      .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
      .bind(user.id, mangaId, Date.now())
      .run();
    return json({ ok: true });
  }

  const favoriteMatch = path.match(/^favorites\/([^/]+)$/);
  if (request.method === "DELETE" && favoriteMatch) {
    const mangaId = safeId(decodeURIComponent(favoriteMatch[1]));
    if (!mangaId) return json({ error: "INVALID_MANGA" }, 400);
    await db
      .prepare("DELETE FROM favorites WHERE user_id = ? AND manga_id = ?")
      .bind(user.id, mangaId)
      .run();
    return json({ ok: true });
  }

  if (request.method === "PUT" && path === "progress") {
    const body = await readJson(request);
    const mangaId = safeId(body.mangaId);
    const chapter = Number(body.chapter);
    const percent = Number(body.percent);
    const clientUpdatedAt = Number(body.updatedAt);
    if (
      !mangaId ||
      !Number.isFinite(chapter) ||
      chapter < 0 ||
      !Number.isFinite(percent)
    ) {
      return json({ error: "INVALID_PROGRESS" }, 400);
    }

    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const updatedAt = Number.isFinite(clientUpdatedAt)
      ? Math.min(Math.max(0, clientUpdatedAt), Date.now() + 5 * 60 * 1000)
      : Date.now();
    const completed = normalizedPercent >= 98 ? 1 : 0;

    await db.batch([
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET
             percent = excluded.percent,
             completed = CASE WHEN reading_progress.completed = 1 OR excluded.completed = 1 THEN 1 ELSE 0 END,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= reading_progress.updated_at`,
        )
        .bind(user.id, mangaId, chapter, normalizedPercent, completed, updatedAt),
      db
        .prepare(
          `INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             last_manga_id = excluded.last_manga_id,
             last_chapter = excluded.last_chapter,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= user_state.updated_at`,
        )
        .bind(user.id, mangaId, chapter, updatedAt),
      db
        .prepare(`INSERT INTO user_library
          (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
         VALUES (?, ?, 'reading', ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, manga_id) DO UPDATE SET
           status = CASE WHEN user_library.status = 'planned' THEN 'reading' ELSE user_library.status END,
           updated_at = MAX(user_library.updated_at, excluded.updated_at),
           last_read_at = CASE
             WHEN user_library.last_read_at IS NULL OR excluded.last_read_at >= user_library.last_read_at
               THEN excluded.last_read_at
             ELSE user_library.last_read_at
           END,
           last_read_chapter = CASE
             WHEN user_library.last_read_at IS NULL OR excluded.last_read_at >= user_library.last_read_at
               THEN excluded.last_read_chapter
             ELSE user_library.last_read_chapter
           END,
           highest_reached_chapter = CASE
             WHEN user_library.highest_reached_chapter IS NULL THEN excluded.highest_reached_chapter
             ELSE MAX(user_library.highest_reached_chapter, excluded.highest_reached_chapter)
           END`)
        .bind(user.id, mangaId, updatedAt, updatedAt, updatedAt, chapter, chapter),
    ]);

    return json({ ok: true });
  }

  if (request.method === "GET" && path === "friends") {
    return json({ friends: await getFriends(db, user.id) });
  }

  if (request.method === "POST" && path === "friends") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    if (!username) return json({ error: "INVALID_USERNAME" }, 400);
    const friend = await db
      .prepare("SELECT id, username, name FROM users WHERE username = ? LIMIT 1")
      .bind(username)
      .first();
    if (!friend || friend.id === user.id) {
      return json({ error: "FRIEND_NOT_FOUND", message: "ما لقينا هذا الحساب." }, 404);
    }
    const now = Date.now();
    await db.batch([
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(user.id, friend.id, now),
      db
        .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
        .bind(friend.id, user.id, now),
    ]);
    return json({ friend: publicUser(friend) }, 201);
  }

  const friendMatch = path.match(/^friends\/([^/]+)$/);
  if (request.method === "DELETE" && friendMatch) {
    const friendId = safeId(decodeURIComponent(friendMatch[1]));
    if (!friendId) return json({ error: "INVALID_FRIEND" }, 400);
    await db.batch([
      db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(user.id, friendId),
      db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(friendId, user.id),
    ]);
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "import") {
    const body = await readJson(request);
    await importLegacyData(db, user.id, body.data);
    return json({ data: await getUserData(db, user.id) });
  }

  if (request.method === "POST" && path === "change-password") {
    const body = await readJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 4 || newPassword.length > 128) {
      return json({ error: "WEAK_PASSWORD", message: "كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر." }, 400);
    }

    const authRow = await db
      .prepare(
        "SELECT id, password_salt, password_hash, password_iterations FROM users WHERE id = ? LIMIT 1",
      )
      .bind(user.id)
      .first();
    if (!authRow || !(await verifyPassword(currentPassword, authRow))) {
      return json({ error: "WRONG_PASSWORD", message: "كلمة المرور الحالية غير صحيحة." }, 400);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bytesToBase64Url(saltBytes);
    const hash = await derivePasswordHash(newPassword, saltBytes, PASSWORD_ITERATIONS);
    const now = Date.now();
    await db
      .prepare(
        "UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE id = ?",
      )
      .bind(salt, hash, PASSWORD_ITERATIONS, now, user.id)
      .run();
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
      .bind(user.id, session.tokenHash)
      .run();
    return json({ ok: true });
  }

  return json({ error: "NOT_FOUND" }, 404);
}

async function ensureDatabase(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    .run();
  const version = await db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version' LIMIT 1")
    .first();
  if (version?.value === "4") return;
  if (version?.value === "3") {
    await db.batch([
      ...listSchemaStatements(db),
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '4')"),
    ]);
    return;
  }
  if (version?.value === "2") {
    await db.batch([
      ...librarySchemaStatements(db),
      ...libraryBackfillStatements(db),
      ...listSchemaStatements(db),
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '4')"),
    ]);
    return;
  }

  const now = Date.now();
  const statements = [
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_iterations INTEGER NOT NULL DEFAULT 210000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, manga_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reading_progress (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      percent REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, manga_id, chapter),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON reading_progress(user_id, updated_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      last_manga_id TEXT,
      last_chapter INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id),
      CHECK (user_id <> friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    ...librarySchemaStatements(db),
    ...listSchemaStatements(db),
  ];

  for (const seeded of SEEDED_USERS) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO users
            (id, username, name, password_salt, password_hash, password_iterations, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          seeded.id,
          seeded.username,
          seeded.name,
          seeded.salt,
          seeded.hash,
          PASSWORD_ITERATIONS,
          now,
          now,
        ),
    );
  }

  for (const [userId, favorites] of Object.entries(SEEDED_FAVORITES)) {
    for (const mangaId of favorites) {
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
          .bind(userId, mangaId, now),
      );
    }
  }

  for (const [userId, mangaId, chapter, percent, completed] of SEEDED_PROGRESS) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, mangaId, chapter, percent, completed, now),
    );
  }

  for (const [userId, mangaId, chapter] of [
    ["mahdi", "returner", 143],
    ["kaido", "eleceed", 315],
    ["ahmed", "solo", 197],
  ]) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO user_state (user_id, last_manga_id, last_chapter, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(userId, mangaId, chapter, now),
    );
  }

  for (const user of SEEDED_USERS) {
    for (const friend of SEEDED_USERS) {
      if (user.id === friend.id) continue;
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)")
          .bind(user.id, friend.id, now),
      );
    }
  }

  statements.push(...libraryBackfillStatements(db));
  statements.push(
    db
      .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '4')"),
  );
  await db.batch(statements);
}

function librarySchemaStatements(db) {
  return [
    db.prepare(`CREATE TABLE IF NOT EXISTS user_library (
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('reading','completed','paused','planned')),
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_read_at INTEGER,
      last_read_chapter REAL,
      highest_reached_chapter REAL,
      PRIMARY KEY (user_id, manga_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_user_library_recent ON user_library(user_id, last_read_at DESC, updated_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      chapter REAL NOT NULL,
      read_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_reading_history_user_time ON reading_history(user_id, read_at DESC, id DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_reading_history_user_work ON reading_history(user_id, manga_id, read_at DESC)"),
  ];
}

function libraryBackfillStatements(db) {
  return [
    db.prepare(`INSERT OR IGNORE INTO user_library
      (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
      SELECT user_id, manga_id, 'planned', created_at, created_at, NULL, NULL, NULL
      FROM favorites`),
    db.prepare(`INSERT OR IGNORE INTO user_library
      (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
      SELECT
        p.user_id,
        p.manga_id,
        'reading',
        MIN(p.updated_at),
        MAX(p.updated_at),
        MAX(p.updated_at),
        (
          SELECT rp.chapter
          FROM reading_progress rp
          WHERE rp.user_id = p.user_id AND rp.manga_id = p.manga_id
          ORDER BY rp.updated_at DESC, rp.chapter DESC
          LIMIT 1
        ),
        MAX(p.chapter)
      FROM reading_progress p
      GROUP BY p.user_id, p.manga_id`),
    db.prepare(`UPDATE user_library
      SET
        status = CASE
          WHEN status = 'planned' AND EXISTS (
            SELECT 1 FROM reading_progress rp
            WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          ) THEN 'reading'
          ELSE status
        END,
        updated_at = MAX(
          updated_at,
          COALESCE((
            SELECT MAX(rp.updated_at)
            FROM reading_progress rp
            WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          ), updated_at)
        ),
        last_read_at = COALESCE((
          SELECT MAX(rp.updated_at)
          FROM reading_progress rp
          WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
        ), last_read_at),
        last_read_chapter = COALESCE((
          SELECT rp.chapter
          FROM reading_progress rp
          WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          ORDER BY rp.updated_at DESC, rp.chapter DESC
          LIMIT 1
        ), last_read_chapter),
        highest_reached_chapter = CASE
          WHEN (
            SELECT MAX(rp.chapter)
            FROM reading_progress rp
            WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          ) IS NULL THEN highest_reached_chapter
          WHEN highest_reached_chapter IS NULL THEN (
            SELECT MAX(rp.chapter)
            FROM reading_progress rp
            WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          )
          ELSE MAX(highest_reached_chapter, (
            SELECT MAX(rp.chapter)
            FROM reading_progress rp
            WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
          ))
        END
      WHERE EXISTS (
        SELECT 1 FROM reading_progress rp
        WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
      )`),
  ];
}

function listSchemaStatements(db) {
  return [
    db.prepare(`CREATE TABLE IF NOT EXISTS user_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_user_lists_user_position ON user_lists(user_id, position ASC, created_at ASC)",
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_list_items (
      list_id TEXT NOT NULL,
      manga_id TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (list_id, manga_id),
      FOREIGN KEY (list_id) REFERENCES user_lists(id) ON DELETE CASCADE
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_user_list_items_position ON user_list_items(list_id, position ASC, added_at ASC)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_user_list_items_work ON user_list_items(manga_id, list_id)",
    ),
  ];
}

async function getUserLists(db, userId) {
  const result = await db
    .prepare(
      `SELECT
         l.id, l.name, l.description, l.position, l.created_at, l.updated_at,
         COUNT(i.manga_id) AS item_count
       FROM user_lists l
       LEFT JOIN user_list_items i ON i.list_id = l.id
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY l.position ASC, l.created_at ASC, l.id ASC`,
    )
    .bind(userId)
    .all();
  return (result.results ?? []).map(mapUserList);
}

function mapUserList(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    position: Number(row.position),
    itemCount: Number(row.item_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizeListInput(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawDescription =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80 || rawDescription.length > 500) return null;
  return {
    name,
    description: rawDescription || null,
  };
}

async function reorderUserListItem(db, userId, listId, mangaId, beforeId, afterId) {
  const owned = await db
    .prepare("SELECT id FROM user_lists WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(listId, userId)
    .first();
  if (!owned) return { ok: false, error: "LIST_NOT_FOUND", status: 404 };

  const result = await db
    .prepare(
      `SELECT manga_id, position, added_at
       FROM user_list_items
       WHERE list_id = ?
       ORDER BY position ASC, added_at ASC, manga_id ASC`,
    )
    .bind(listId)
    .all();
  const rows = (result.results ?? []).map((row) => ({
    mangaId: row.manga_id,
    position: Number(row.position),
    addedAt: Number(row.added_at),
  }));
  const current = rows.find((row) => row.mangaId === mangaId);
  if (!current) return { ok: false, error: "LIST_ITEM_NOT_FOUND", status: 404 };

  const remaining = rows.filter((row) => row.mangaId !== mangaId);
  let targetIndex = remaining.length;
  if (beforeId) {
    const index = remaining.findIndex((row) => row.mangaId === beforeId);
    if (index < 0) return { ok: false, error: "INVALID_REORDER_TARGET", status: 409 };
    targetIndex = index;
  } else if (afterId) {
    const index = remaining.findIndex((row) => row.mangaId === afterId);
    if (index < 0) return { ok: false, error: "INVALID_REORDER_TARGET", status: 409 };
    targetIndex = index + 1;
  }

  const nextOrder = [...remaining];
  nextOrder.splice(targetIndex, 0, current);
  const previous = nextOrder[targetIndex - 1] ?? null;
  const next = nextOrder[targetIndex + 1] ?? null;
  const now = Date.now();

  if (previous && next && next.position - previous.position <= 0.001) {
    const statements = nextOrder.map((row, index) =>
      db
        .prepare("UPDATE user_list_items SET position = ? WHERE list_id = ? AND manga_id = ?")
        .bind((index + 1) * 1024, listId, row.mangaId),
    );
    statements.push(
      db.prepare("UPDATE user_lists SET updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(now, listId, userId),
    );
    await db.batch(statements);
    return { ok: true };
  }

  let position = 1024;
  if (previous && next) position = (previous.position + next.position) / 2;
  else if (previous) position = previous.position + 1024;
  else if (next) position = next.position - 1024;

  await db.batch([
    db.prepare("UPDATE user_list_items SET position = ? WHERE list_id = ? AND manga_id = ?")
      .bind(position, listId, mangaId),
    db.prepare("UPDATE user_lists SET updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(now, listId, userId),
  ]);
  return { ok: true };
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT
         s.token_hash, s.user_id, s.expires_at, s.last_seen_at,
         u.id, u.username, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first();
  if (!row) return null;
  if (now - Number(row.last_seen_at) > 60 * 60 * 1000) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash)
      .run();
  }
  return {
    tokenHash,
    user: { id: row.id, username: row.username, name: row.name },
  };
}

async function getUserData(db, userId) {
  const [favoriteResult, progressResult, state, libraryResult] = await Promise.all([
    db
      .prepare("SELECT manga_id FROM favorites WHERE user_id = ? ORDER BY created_at ASC")
      .bind(userId)
      .all(),
    db
      .prepare(
        "SELECT manga_id, chapter, percent, completed, updated_at FROM reading_progress WHERE user_id = ?",
      )
      .bind(userId)
      .all(),
    db
      .prepare("SELECT last_manga_id, last_chapter FROM user_state WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first(),
    db
      .prepare(`SELECT
        manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter
       FROM user_library
       WHERE user_id = ?
       ORDER BY COALESCE(last_read_at, updated_at) DESC, updated_at DESC`)
      .bind(userId)
      .all(),
  ]);

  const progress = {};
  const completed = [];
  for (const row of progressResult.results ?? []) {
    const key = `${row.manga_id}:${row.chapter}`;
    progress[key] = {
      mangaId: row.manga_id,
      chapter: Number(row.chapter),
      percent: Number(row.percent),
      updatedAt: Number(row.updated_at),
    };
    if (Number(row.completed) === 1) completed.push(key);
  }

  const library = (libraryResult.results ?? []).map((row) => ({
    mangaId: row.manga_id,
    status: row.status,
    addedAt: Number(row.added_at),
    updatedAt: Number(row.updated_at),
    lastReadAt: row.last_read_at == null ? null : Number(row.last_read_at),
    lastReadChapter: row.last_read_chapter == null ? null : Number(row.last_read_chapter),
    highestReachedChapter:
      row.highest_reached_chapter == null ? null : Number(row.highest_reached_chapter),
  }));

  return {
    version: 3,
    favorites: (favoriteResult.results ?? []).map((row) => row.manga_id),
    library,
    progress,
    completed,
    lastOpened:
      state?.last_manga_id != null && state?.last_chapter != null
        ? { mangaId: state.last_manga_id, chapter: Number(state.last_chapter) }
        : null,
  };
}

async function getFriends(db, userId) {
  const result = await db
    .prepare(
      `SELECT u.id, u.username, u.name
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?
       ORDER BY u.name COLLATE NOCASE ASC`,
    )
    .bind(userId)
    .all();
  const users = result.results ?? [];
  if (!users.length) return [];

  const ids = users.map((user) => user.id);
  const placeholders = ids.map(() => "?").join(",");
  const [favoritesResult, stateResult, progressResult] = await Promise.all([
    db
      .prepare(`SELECT user_id, manga_id FROM favorites WHERE user_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...ids)
      .all(),
    db
      .prepare(`SELECT user_id, last_manga_id, last_chapter FROM user_state WHERE user_id IN (${placeholders})`)
      .bind(...ids)
      .all(),
    db
      .prepare(
        `SELECT user_id, manga_id, chapter, updated_at
         FROM reading_progress
         WHERE user_id IN (${placeholders})
         ORDER BY updated_at DESC`,
      )
      .bind(...ids)
      .all(),
  ]);

  const favorites = new Map(ids.map((id) => [id, []]));
  for (const row of favoritesResult.results ?? []) {
    favorites.get(row.user_id)?.push(row.manga_id);
  }

  const reading = new Map();
  for (const row of stateResult.results ?? []) {
    if (row.last_manga_id != null && row.last_chapter != null) {
      reading.set(row.user_id, {
        mangaId: row.last_manga_id,
        chapter: Number(row.last_chapter),
      });
    }
  }
  for (const row of progressResult.results ?? []) {
    if (!reading.has(row.user_id)) {
      reading.set(row.user_id, {
        mangaId: row.manga_id,
        chapter: Number(row.chapter),
      });
    }
  }

  return users.map((friend) => ({
    user: publicUser(friend),
    reading: reading.get(friend.id) ?? null,
    favorites: favorites.get(friend.id) ?? [],
  }));
}

async function importLegacyData(db, userId, data) {
  if (!data || typeof data !== "object") return;
  const favorites = Array.isArray(data.favorites) ? data.favorites.map(safeId).filter(Boolean) : [];
  const progressEntries = data.progress && typeof data.progress === "object"
    ? Object.values(data.progress)
    : [];
  const completed = new Set(Array.isArray(data.completed) ? data.completed.filter((value) => typeof value === "string") : []);
  const statements = [];
  const now = Date.now();

  for (const mangaId of favorites.slice(0, 500)) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO favorites (user_id, manga_id, created_at) VALUES (?, ?, ?)")
        .bind(userId, mangaId, now),
    );
  }

  for (const item of progressEntries.slice(0, 2000)) {
    if (!item || typeof item !== "object") continue;
    const mangaId = safeId(item.mangaId);
    const chapter = Number(item.chapter);
    const percent = Number(item.percent);
    const incomingUpdatedAt = Number(item.updatedAt);
    if (!mangaId || !Number.isInteger(chapter) || chapter < 0 || !Number.isFinite(percent)) continue;
    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const key = `${mangaId}:${chapter}`;
    const isCompleted = completed.has(key) || normalizedPercent >= 98 ? 1 : 0;
    const updatedAt = Number.isFinite(incomingUpdatedAt) && incomingUpdatedAt > 0
      ? Math.min(incomingUpdatedAt, Date.now() + 5 * 60 * 1000)
      : 0;
    statements.push(
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET
             percent = excluded.percent,
             completed = CASE WHEN reading_progress.completed = 1 OR excluded.completed = 1 THEN 1 ELSE 0 END,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > reading_progress.updated_at`,
        )
        .bind(userId, mangaId, chapter, normalizedPercent, isCompleted, updatedAt),
    );
  }

  for (const key of [...completed].slice(0, 2000)) {
    const split = key.lastIndexOf(":");
    if (split <= 0) continue;
    const mangaId = safeId(key.slice(0, split));
    const chapter = Number(key.slice(split + 1));
    if (!mangaId || !Number.isInteger(chapter) || chapter < 0) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO reading_progress
            (user_id, manga_id, chapter, percent, completed, updated_at)
           VALUES (?, ?, ?, 100, 1, 0)
           ON CONFLICT(user_id, manga_id, chapter) DO UPDATE SET completed = 1`,
        )
        .bind(userId, mangaId, chapter),
    );
  }

  const lastMangaId = safeId(data.lastOpened?.mangaId);
  const lastChapter = Number(data.lastOpened?.chapter);
  if (lastMangaId && Number.isInteger(lastChapter) && lastChapter >= 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_state (user_id, last_manga_id, last_chapter, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             last_manga_id = excluded.last_manga_id,
             last_chapter = excluded.last_chapter,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, lastMangaId, lastChapter, now),
    );
  }

  if (statements.length) await db.batch(statements);
}

async function verifyPassword(password, row) {
  const salt = base64UrlToBytes(row.password_salt);
  const derived = await derivePasswordHash(password, salt, Number(row.password_iterations));
  return timingSafeEqual(base64UrlToBytes(derived), base64UrlToBytes(row.password_hash));
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
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

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function sessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name };
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : "";
}

function libraryStatus(value) {
  return value === "reading" || value === "completed" || value === "paused" || value === "planned"
    ? value
    : "";
}

function safeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(normalized) ? normalized : "";
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new Error("Request body too large");
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return {};
  return await request.json();
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
