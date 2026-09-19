-- Canonical account IDs: immutable user id equals lowercase username.
UPDATE users SET username = '__legacy_h__' WHERE id = 'has';
UPDATE users SET username = '__legacy_y__' WHERE id = 'yas';

INSERT OR IGNORE INTO users
  (id, username, name, password_salt, password_hash, password_iterations, created_at, updated_at, profile_visibility, avatar_id, role)
SELECT 'h', 'h', name, password_salt, password_hash, password_iterations, created_at, updated_at, profile_visibility, avatar_id, role
FROM users WHERE id = 'has';
INSERT OR IGNORE INTO users
  (id, username, name, password_salt, password_hash, password_iterations, created_at, updated_at, profile_visibility, avatar_id, role)
SELECT 'y', 'y', name, password_salt, password_hash, password_iterations, created_at, updated_at, profile_visibility, avatar_id, role
FROM users WHERE id = 'yas';

UPDATE sessions SET user_id = 'h' WHERE user_id = 'has'; UPDATE sessions SET user_id = 'y' WHERE user_id = 'yas';
UPDATE favorites SET user_id = 'h' WHERE user_id = 'has'; UPDATE favorites SET user_id = 'y' WHERE user_id = 'yas';
UPDATE reading_progress SET user_id = 'h' WHERE user_id = 'has'; UPDATE reading_progress SET user_id = 'y' WHERE user_id = 'yas';
UPDATE user_state SET user_id = 'h' WHERE user_id = 'has'; UPDATE user_state SET user_id = 'y' WHERE user_id = 'yas';
UPDATE user_library SET user_id = 'h' WHERE user_id = 'has'; UPDATE user_library SET user_id = 'y' WHERE user_id = 'yas';
UPDATE reading_history SET user_id = 'h' WHERE user_id = 'has'; UPDATE reading_history SET user_id = 'y' WHERE user_id = 'yas';
UPDATE user_lists SET user_id = 'h' WHERE user_id = 'has'; UPDATE user_lists SET user_id = 'y' WHERE user_id = 'yas';
UPDATE user_profile_sections SET user_id = 'h' WHERE user_id = 'has'; UPDATE user_profile_sections SET user_id = 'y' WHERE user_id = 'yas';
UPDATE activity_events SET user_id = 'h' WHERE user_id = 'has'; UPDATE activity_events SET user_id = 'y' WHERE user_id = 'yas';
UPDATE account_recovery SET user_id = 'h' WHERE user_id = 'has'; UPDATE account_recovery SET user_id = 'y' WHERE user_id = 'yas';

UPDATE friendships SET user_id = 'h' WHERE user_id = 'has'; UPDATE friendships SET user_id = 'y' WHERE user_id = 'yas';
UPDATE friendships SET friend_id = 'h' WHERE friend_id = 'has'; UPDATE friendships SET friend_id = 'y' WHERE friend_id = 'yas';

UPDATE friend_requests SET pair_low_id = 'h' WHERE pair_low_id = 'has'; UPDATE friend_requests SET pair_low_id = 'y' WHERE pair_low_id = 'yas';
UPDATE friend_requests SET pair_high_id = 'h' WHERE pair_high_id = 'has'; UPDATE friend_requests SET pair_high_id = 'y' WHERE pair_high_id = 'yas';
UPDATE friend_requests SET requester_id = 'h' WHERE requester_id = 'has'; UPDATE friend_requests SET requester_id = 'y' WHERE requester_id = 'yas';
UPDATE friend_requests SET receiver_id = 'h' WHERE receiver_id = 'has'; UPDATE friend_requests SET receiver_id = 'y' WHERE receiver_id = 'yas';

UPDATE admin_audit_log SET admin_user_id = 'h' WHERE admin_user_id = 'has'; UPDATE admin_audit_log SET admin_user_id = 'y' WHERE admin_user_id = 'yas';
UPDATE admin_audit_log SET target_user_id = 'h' WHERE target_user_id = 'has'; UPDATE admin_audit_log SET target_user_id = 'y' WHERE target_user_id = 'yas';

DELETE FROM users WHERE id IN ('has', 'yas');
UPDATE users SET username = 'm' WHERE id = 'm';
UPDATE users SET username = 'admin' WHERE id = 'admin';
INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '14');
