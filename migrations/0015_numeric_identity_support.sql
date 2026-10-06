-- Additive support only. The private migration tool moves actual account data.
-- Do not mark schema_version=20 until that migration and its validation complete.
CREATE TABLE IF NOT EXISTS user_identity_aliases (
  old_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_identity_aliases_user ON user_identity_aliases(user_id);

CREATE TABLE IF NOT EXISTS auth_attempt_windows (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1)
);
CREATE INDEX IF NOT EXISTS idx_auth_attempt_window_start ON auth_attempt_windows(window_start);

CREATE TABLE IF NOT EXISTS work_snapshot_cover_locations (
  user_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  r2_user_id TEXT NOT NULL,
  PRIMARY KEY (user_id, manga_id),
  FOREIGN KEY (user_id, manga_id) REFERENCES work_snapshots(user_id, manga_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_password_verifiers (
  user_id TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  PRIMARY KEY (user_id, password_salt, password_hash, password_iterations),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_recovery_verifiers (
  user_id TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK (scheme IN ('pbkdf2-sha256', 'sha256')),
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_iterations INTEGER NOT NULL,
  PRIMARY KEY (user_id, scheme, recovery_salt, recovery_hash, recovery_iterations),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Some v19 runtime databases never applied the older SQL-only recovery table.
CREATE TABLE IF NOT EXISTS account_recovery (
  user_id TEXT PRIMARY KEY,
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_iterations INTEGER NOT NULL DEFAULT 210000,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
