-- Recovery schema only. Codes must be generated privately per account.
CREATE TABLE IF NOT EXISTS account_recovery (
  user_id TEXT PRIMARY KEY,
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_iterations INTEGER NOT NULL DEFAULT 210000,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

