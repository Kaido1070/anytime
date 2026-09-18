-- Rename the owner's username from mah to m.
-- Guard against a conflicting existing username so deployment does not fail.
UPDATE users
SET username = 'm',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE username = 'mah' COLLATE NOCASE
  AND NOT EXISTS (
    SELECT 1
    FROM users
    WHERE username = 'm' COLLATE NOCASE
  );
