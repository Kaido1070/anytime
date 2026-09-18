ALTER TABLE users
  ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (profile_visibility IN ('public','private'));

CREATE INDEX IF NOT EXISTS idx_users_profile_visibility
  ON users(profile_visibility, id);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '6');
