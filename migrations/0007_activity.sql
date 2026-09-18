-- Phase 7: lightweight activity feed and modular activity sections.

DROP INDEX IF EXISTS idx_user_profile_sections_user_position;

CREATE TABLE user_profile_sections_v8 (
  user_id TEXT NOT NULL,
  section_type TEXT NOT NULL CHECK (
    section_type IN (
      'continue_reading',
      'favorites',
      'custom_list',
      'my_activity',
      'friends_activity'
    )
  ),
  reference_id TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, section_type, reference_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_profile_sections_v8
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT
  user_id, section_type, reference_id, position, is_visible, created_at, updated_at
FROM user_profile_sections;

DROP TABLE user_profile_sections;

ALTER TABLE user_profile_sections_v8 RENAME TO user_profile_sections;

CREATE INDEX idx_user_profile_sections_user_position
  ON user_profile_sections(user_id, position ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'started_work',
      'progress_reached',
      'completed_work',
      'favorited_work',
      'added_to_list',
      'created_list'
    )
  ),
  manga_id TEXT,
  list_id TEXT,
  chapter_number REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id) REFERENCES user_lists(id) ON DELETE CASCADE,
  CHECK (
    (type IN ('started_work','completed_work','favorited_work') AND manga_id IS NOT NULL)
    OR (type = 'progress_reached' AND manga_id IS NOT NULL AND chapter_number IS NOT NULL)
    OR (type = 'added_to_list' AND manga_id IS NOT NULL AND list_id IS NOT NULL)
    OR (type = 'created_list' AND list_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_user_created
  ON activity_events(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_user_type_work_updated
  ON activity_events(user_id, type, manga_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_list
  ON activity_events(list_id, created_at DESC, id DESC);
