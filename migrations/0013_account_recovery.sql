-- One fixed recovery code per account. Only PBKDF2 hashes are stored.
CREATE TABLE IF NOT EXISTS account_recovery (
  user_id TEXT PRIMARY KEY,
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_iterations INTEGER NOT NULL DEFAULT 210000,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO account_recovery (user_id, recovery_salt, recovery_hash, recovery_iterations, created_at)
SELECT id, 'iXMrYFxlRGeNeXtahvJrxg', 'qB91GPghZPSkaJ4EkLZlQ4O33bYMktRSEWQ8TzHiJ08', 210000, unixepoch()*1000 FROM users WHERE username = 'admin' COLLATE NOCASE;
INSERT OR IGNORE INTO account_recovery (user_id, recovery_salt, recovery_hash, recovery_iterations, created_at)
SELECT id, 'DQKmZM9LWDe-yvsralJ3NA', 'gk2_0df_3o7dJprXj1IzLcRnJUUmiGF1YgfjXKhe0T8', 210000, unixepoch()*1000 FROM users WHERE username = 'm' COLLATE NOCASE;
INSERT OR IGNORE INTO account_recovery (user_id, recovery_salt, recovery_hash, recovery_iterations, created_at)
SELECT id, 'yzbZYsIxWd_q11a259Vekg', 'JkkmyqM-AxXhtFvjyuGw2_tgIOix_C1O0Zww0gEowC0', 210000, unixepoch()*1000 FROM users WHERE username = 'yas' COLLATE NOCASE;
INSERT OR IGNORE INTO account_recovery (user_id, recovery_salt, recovery_hash, recovery_iterations, created_at)
SELECT id, 'kfncionM84kNNDTiZGagDQ', 'hYOzUUBxo4VWBLVZHUpPbWyufAcPqN11e6GckRtyO_c', 210000, unixepoch()*1000 FROM users WHERE username = 'has' COLLATE NOCASE;
