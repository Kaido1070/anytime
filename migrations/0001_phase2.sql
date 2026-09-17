CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, manga_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, manga_id, chapter),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON reading_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  last_manga_id TEXT,
  last_chapter INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stable internal IDs are retained so existing sessions and friendships survive account renames.
INSERT OR IGNORE INTO users VALUES
  ('mahdi','has','Has','nckWsLoOqPQ2ko0y6KFcdQ','Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE',210000,unixepoch()*1000,unixepoch()*1000),
  ('kaido','yas','Yas','w-fi6L0FIdkx0NNSYyhvdg','g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y',210000,unixepoch()*1000,unixepoch()*1000),
  ('ahmed','mah','Mah','4ueIIy1PaWKbbDjqIkf39g','Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI',210000,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO friendships VALUES
  ('mahdi','kaido',unixepoch()*1000),
  ('mahdi','ahmed',unixepoch()*1000),
  ('kaido','mahdi',unixepoch()*1000),
  ('kaido','ahmed',unixepoch()*1000),
  ('ahmed','mahdi',unixepoch()*1000),
  ('ahmed','kaido',unixepoch()*1000);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '2');
