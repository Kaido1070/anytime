CREATE TABLE IF NOT EXISTS user_library (
  user_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('reading','completed','paused','planned')),
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_read_at INTEGER,
  last_read_chapter REAL,
  highest_reached_chapter REAL,
  PRIMARY KEY (user_id, manga_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_library_recent
  ON user_library(user_id, last_read_at DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  chapter REAL NOT NULL,
  read_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reading_history_user_time
  ON reading_history(user_id, read_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reading_history_user_work
  ON reading_history(user_id, manga_id, read_at DESC);

INSERT OR IGNORE INTO user_library
  (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
SELECT user_id, manga_id, 'planned', created_at, created_at, NULL, NULL, NULL
FROM favorites;

INSERT OR IGNORE INTO user_library
  (user_id, manga_id, status, added_at, updated_at, last_read_at, last_read_chapter, highest_reached_chapter)
SELECT
  p.user_id,
  p.manga_id,
  'reading',
  MIN(p.updated_at),
  MAX(p.updated_at),
  MAX(p.updated_at),
  (
    SELECT rp.chapter
    FROM reading_progress rp
    WHERE rp.user_id = p.user_id AND rp.manga_id = p.manga_id
    ORDER BY rp.updated_at DESC, rp.chapter DESC
    LIMIT 1
  ),
  MAX(p.chapter)
FROM reading_progress p
GROUP BY p.user_id, p.manga_id;

UPDATE user_library
SET
  status = CASE
    WHEN status = 'planned' AND EXISTS (
      SELECT 1 FROM reading_progress rp
      WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    ) THEN 'reading'
    ELSE status
  END,
  updated_at = MAX(
    updated_at,
    COALESCE((
      SELECT MAX(rp.updated_at)
      FROM reading_progress rp
      WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    ), updated_at)
  ),
  last_read_at = COALESCE((
    SELECT MAX(rp.updated_at)
    FROM reading_progress rp
    WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
  ), last_read_at),
  last_read_chapter = COALESCE((
    SELECT rp.chapter
    FROM reading_progress rp
    WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    ORDER BY rp.updated_at DESC, rp.chapter DESC
    LIMIT 1
  ), last_read_chapter),
  highest_reached_chapter = CASE
    WHEN (
      SELECT MAX(rp.chapter)
      FROM reading_progress rp
      WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    ) IS NULL THEN highest_reached_chapter
    WHEN highest_reached_chapter IS NULL THEN (
      SELECT MAX(rp.chapter)
      FROM reading_progress rp
      WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    )
    ELSE MAX(highest_reached_chapter, (
      SELECT MAX(rp.chapter)
      FROM reading_progress rp
      WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
    ))
  END
WHERE EXISTS (
  SELECT 1 FROM reading_progress rp
  WHERE rp.user_id = user_library.user_id AND rp.manga_id = user_library.manga_id
);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '3');
