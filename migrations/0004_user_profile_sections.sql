CREATE TABLE IF NOT EXISTS user_profile_sections (
  user_id TEXT NOT NULL,
  section_type TEXT NOT NULL CHECK (section_type IN ('continue_reading','favorites','custom_list')),
  reference_id TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, section_type, reference_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profile_sections_user_position
  ON user_profile_sections(user_id, position ASC, created_at ASC);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '5');
