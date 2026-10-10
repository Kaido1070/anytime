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
    badgeType: row.badge_type === "crown" || row.badge_type === "verified" ? row.badge_type : null,
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
      // Request-time validation is read-only. Deployment owns schema changes.
      const columns = await db.prepare("PRAGMA table_info(users)").all();
      const hasRole = (columns.results ?? []).some((column) => column.name === "role");
      const audit = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_log'").first();
      if (!hasRole || !audit) {
        const error = new Error("Admin schema is missing; apply deployment migrations.");
        error.code = "SCHEMA_MIGRATION_REQUIRED";
        throw error;
      }
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

