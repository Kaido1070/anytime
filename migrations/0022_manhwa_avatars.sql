-- Add a distinct Manhwa avatar shelf without rebuilding the original 10-series
-- tables or modifying any existing user/avatar rows.
-- The physical series_id is a storage parent required by the legacy avatar FK.
-- avatar_display_categories is the authoritative presentation category.
CREATE TABLE IF NOT EXISTS avatar_display_categories (
  avatar_id TEXT PRIMARY KEY REFERENCES avatars(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('manhwa')),
  work_title TEXT NOT NULL,
  display_position INTEGER NOT NULL CHECK (display_position BETWEEN 1 AND 10),
  UNIQUE (category, display_position)
);

-- The existing Sung Jinwoo portrait is reused, not duplicated.
INSERT OR IGNORE INTO avatars
  (id, series_id, character_name, image_path, position, is_active, created_at, updated_at)
VALUES
  ('manhwa:kim-dokja','solo-leveling','Kim Dokja','anilist:Dokja Kim',6,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:twenty-fifth-bam','solo-leveling','Twenty-Fifth Bam','anilist:Twenty-Fifth Bam',7,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:cheon-yeowoon','solo-leveling','Cheon Yeo-Woon','anilist:Cheon Yeo-Woon',8,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:jin-muwon','solo-leveling','Jin Mu-Won','anilist:Jin Mu-Won',9,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:chung-myung','solo-leveling','Chung Myung','anilist:Chung Myung',10,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:seo-jiwoo','solo-leveling','Seo Jiwoo','anilist:Jiwoo Seo',11,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:grid','solo-leveling','Grid','anilist:Shin Youngwoo',12,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:lloyd-frontera','solo-leveling','Lloyd Frontera','anilist:Lloyd Frontera',13,1,unixepoch()*1000,unixepoch()*1000),
  ('manhwa:daniel-park','solo-leveling','Daniel Park','anilist:Daniel Park',14,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_display_categories
  (avatar_id, category, work_title, display_position)
VALUES
  ('solo-leveling:jinwoo','manhwa','Solo Leveling',1),
  ('manhwa:kim-dokja','manhwa','Omniscient Reader’s Viewpoint',2),
  ('manhwa:twenty-fifth-bam','manhwa','Tower of God',3),
  ('manhwa:cheon-yeowoon','manhwa','Nano Machine',4),
  ('manhwa:jin-muwon','manhwa','Legend of the Northern Blade',5),
  ('manhwa:chung-myung','manhwa','Return of the Mount Hua Sect',6),
  ('manhwa:seo-jiwoo','manhwa','Eleceed',7),
  ('manhwa:grid','manhwa','Overgeared',8),
  ('manhwa:lloyd-frontera','manhwa','The Greatest Estate Developer',9),
  ('manhwa:daniel-park','manhwa','Lookism',10);
