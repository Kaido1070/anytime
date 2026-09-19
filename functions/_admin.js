const adminSchemaReady = new WeakMap();

export function isAdminUser(user) {
  return user?.role === "admin";
}

export function isSocialUser(user) {
  return !user?.role || user.role === "user";
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    profileVisibility:
      row.profile_visibility === "public" || row.profileVisibility === "public"
        ? "public"
        : "private",
    avatarId: row.avatar_id ?? row.avatarId ?? null,
  };
}

export function sessionUser(row) {
  return {
    ...publicUser(row),
    role: row.role === "admin" ? "admin" : "user",
  };
}

export async function ensureAdminSchema(db) {
  let pending = adminSchemaReady.get(db);
  if (!pending) {
    pending = (async () => {
      // Never trust schema_meta alone here. Production databases can have a newer
      // runtime version while still missing the Phase 10 role column.
      // PRAGMA is read-only and preserves every existing user row.
      const columns = await db.prepare("PRAGMA table_info(users)").all();
      const hasRole = (columns.results ?? []).some((column) => column.name === "role");
      if (!hasRole) {
        await db
          .prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'))")
          .run();
      }

      const statements = [
        db.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_users_role_visibility ON users(role, profile_visibility, id)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_user_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('admin_login','view_private_user')),
          target_user_id TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(admin_user_id, created_at DESC, id DESC)"),
      ];
      for (const statement of statements) await statement.run();
    })().catch((error) => {
      adminSchemaReady.delete(db);
      throw error;
    });
    adminSchemaReady.set(db, pending);
  }
  await pending;
}

export async function recordAdminAudit(db, adminUserId, action, targetUserId = null) {
  if (action !== "admin_login" && action !== "view_private_user") return;
  await db
    .prepare("INSERT INTO admin_audit_log (admin_user_id, action, target_user_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(adminUserId, action, targetUserId, Date.now())
    .run();
}
