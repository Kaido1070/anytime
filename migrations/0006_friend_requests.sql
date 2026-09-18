-- Phase 6: mutual friend requests on top of accepted friendships.

CREATE TABLE IF NOT EXISTS friend_requests (
  pair_low_id TEXT NOT NULL,
  pair_high_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pair_low_id, pair_high_id),
  CHECK (pair_low_id <> pair_high_id),
  CHECK (requester_id <> receiver_id),
  CHECK (
    (requester_id = pair_low_id AND receiver_id = pair_high_id)
    OR (requester_id = pair_high_id AND receiver_id = pair_low_id)
  ),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver
  ON friend_requests(receiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_requests_requester
  ON friend_requests(requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friendships_friend
  ON friendships(friend_id, user_id);

CREATE INDEX IF NOT EXISTS idx_users_name_nocase
  ON users(name COLLATE NOCASE, id);
