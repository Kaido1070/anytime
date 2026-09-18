CREATE TABLE IF NOT EXISTS user_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_lists_user_position
  ON user_lists(user_id, position ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS user_list_items (
  list_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, manga_id),
  FOREIGN KEY (list_id) REFERENCES user_lists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_list_items_position
  ON user_list_items(list_id, position ASC, added_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_list_items_work
  ON user_list_items(manga_id, list_id);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '4');
