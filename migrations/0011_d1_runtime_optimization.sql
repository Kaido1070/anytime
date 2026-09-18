-- D1 runtime optimization.
-- Backfill profile sections and indexes once so normal API reads do not run schema writes.

CREATE INDEX IF NOT EXISTS idx_user_library_status
  ON user_library(user_id, status, manga_id);

CREATE INDEX IF NOT EXISTS idx_reading_history_user_chapter
  ON reading_history(user_id, manga_id, chapter);

INSERT OR IGNORE INTO user_profile_sections
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT id, 'continue_reading', '', 1024, 1, unixepoch()*1000, unixepoch()*1000
FROM users
WHERE role = 'user';

INSERT OR IGNORE INTO user_profile_sections
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT id, 'favorites', '', 2048, 1, unixepoch()*1000, unixepoch()*1000
FROM users
WHERE role = 'user';

INSERT OR IGNORE INTO user_profile_sections
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT id, 'my_activity', '', 3072, 1, unixepoch()*1000, unixepoch()*1000
FROM users
WHERE role = 'user';

INSERT OR IGNORE INTO user_profile_sections
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT id, 'friends_activity', '', 4096, 1, unixepoch()*1000, unixepoch()*1000
FROM users
WHERE role = 'user';

INSERT OR IGNORE INTO user_profile_sections
  (user_id, section_type, reference_id, position, is_visible, created_at, updated_at)
SELECT l.user_id, 'custom_list', l.id, 5120 + l.position, 1, unixepoch()*1000, unixepoch()*1000
FROM user_lists l
JOIN users u ON u.id = l.user_id AND u.role = 'user';

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '11');
