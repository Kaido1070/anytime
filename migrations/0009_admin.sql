-- Phase 10: management-only Admin role and audit foundation.

ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','admin'));

CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role, id);

CREATE INDEX IF NOT EXISTS idx_users_role_visibility
  ON users(role, profile_visibility, id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('admin_login','view_private_user')),
  target_user_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit_log(admin_user_id, created_at DESC, id DESC);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '10');
