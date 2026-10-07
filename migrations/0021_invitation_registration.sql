-- Empty invitation tables only. The owner adds codes privately in D1.
-- Additive and optional: existing login does not require these tables.
CREATE TABLE IF NOT EXISTS registration_invites (
  code TEXT PRIMARY KEY CHECK (code GLOB '[0-9][0-9][0-9][0-9]'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS registration_invite_claims (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id),
  FOREIGN KEY (code) REFERENCES registration_invites(code) ON DELETE CASCADE
);
-- Retain claims after account deletion so it cannot free a consumed invitation.
