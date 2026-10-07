-- Tighten invitation codes to exactly four ASCII digits.
-- This migration never seeds an invitation code. Existing rows are copied first:
-- if any legacy code is incompatible, the migration fails before old tables are dropped.
PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS registration_invite_claims_four_digit;
DROP TABLE IF EXISTS registration_invites_four_digit;

CREATE TABLE registration_invites_four_digit (
  code TEXT PRIMARY KEY CHECK (code GLOB '[0-9][0-9][0-9][0-9]'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE registration_invite_claims_four_digit (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id),
  FOREIGN KEY (code) REFERENCES registration_invites_four_digit(code) ON DELETE CASCADE
);

INSERT INTO registration_invites_four_digit (code, enabled, max_uses, expires_at, created_at)
SELECT code, enabled, max_uses, expires_at, created_at
FROM registration_invites;

INSERT INTO registration_invite_claims_four_digit (code, user_id, created_at)
SELECT code, user_id, created_at
FROM registration_invite_claims;

DROP TABLE registration_invite_claims;
DROP TABLE registration_invites;

ALTER TABLE registration_invites_four_digit RENAME TO registration_invites;
ALTER TABLE registration_invite_claims_four_digit RENAME TO registration_invite_claims;
