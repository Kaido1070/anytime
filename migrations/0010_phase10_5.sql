-- Phase 10.5: stable chapter discovery timestamps for New + read-state lookup.
--
-- source_items.first_seen_at is added/backfilled by the source schema guard because
-- source_items is a runtime-owned cache table that can predate SQL migrations.

CREATE TABLE IF NOT EXISTS source_chapter_seen (
  source_key TEXT NOT NULL,
  chapter_identity TEXT NOT NULL,
  chapter_number REAL,
  published_at TEXT,
  first_seen_at INTEGER NOT NULL,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_key, chapter_identity),
  FOREIGN KEY (source_key) REFERENCES source_items(source_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_chapter_seen_release
  ON source_chapter_seen(first_seen_at DESC, source_key);

CREATE INDEX IF NOT EXISTS idx_reading_history_user_chapter
  ON reading_history(user_id, manga_id, chapter);
