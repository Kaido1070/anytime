-- Phase 8: curated Wany avatar library.

CREATE TABLE IF NOT EXISTS avatar_series (
  id TEXT PRIMARY KEY,
  work_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 10),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS avatars (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  image_path TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 15),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (series_id) REFERENCES avatar_series(id) ON DELETE CASCADE,
  UNIQUE (series_id, position),
  UNIQUE (series_id, character_name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_avatars_series_position
  ON avatars(series_id, position ASC);

ALTER TABLE users
  ADD COLUMN avatar_id TEXT REFERENCES avatars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_avatar
  ON users(avatar_id);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('one-piece', NULL, 'ون بيس', 'one-piece', 1, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('one-piece:luffy','one-piece','لوفي','anilist:Monkey D. Luffy',1,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:zoro','one-piece','زورو','anilist:Roronoa Zoro',2,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:nami','one-piece','نامي','anilist:Nami',3,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:sanji','one-piece','سانجي','anilist:Sanji',4,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:robin','one-piece','روبن','anilist:Nico Robin',5,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:chopper','one-piece','تشوبر','anilist:Tony Tony Chopper',6,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:usopp','one-piece','أوسوب','anilist:Usopp',7,1,unixepoch()*1000,unixepoch()*1000),
  ('one-piece:jinbe','one-piece','جينبي','anilist:Jinbe',8,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('naruto', NULL, 'ناروتو', 'naruto', 2, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('naruto:naruto','naruto','ناروتو','anilist:Naruto Uzumaki',1,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:sasuke','naruto','ساسكي','anilist:Sasuke Uchiha',2,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:sakura','naruto','ساكورا','anilist:Sakura Haruno',3,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:kakashi','naruto','كاكاشي','anilist:Kakashi Hatake',4,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:itachi','naruto','إيتاتشي','anilist:Itachi Uchiha',5,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:hinata','naruto','هيناتا','anilist:Hinata Hyuga',6,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:gaara','naruto','غارا','anilist:Gaara',7,1,unixepoch()*1000,unixepoch()*1000),
  ('naruto:shikamaru','naruto','شيكامارو','anilist:Shikamaru Nara',8,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('bleach', NULL, 'بليتش', 'bleach', 3, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('bleach:ichigo','bleach','إيتشيغو','anilist:Ichigo Kurosaki',1,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:rukia','bleach','روكيا','anilist:Rukia Kuchiki',2,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:uryu','bleach','أوريو','anilist:Uryu Ishida',3,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:urahara','bleach','أوراهارا','anilist:Kisuke Urahara',4,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:byakuya','bleach','بياكويا','anilist:Byakuya Kuchiki',5,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:renji','bleach','رينجي','anilist:Renji Abarai',6,1,unixepoch()*1000,unixepoch()*1000),
  ('bleach:aizen','bleach','آيزن','anilist:Sosuke Aizen',7,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('attack-on-titan', NULL, 'هجوم العمالقة', 'attack-on-titan', 4, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('attack-on-titan:eren','attack-on-titan','إيرين','anilist:Eren Yeager',1,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:mikasa','attack-on-titan','ميكاسا','anilist:Mikasa Ackerman',2,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:armin','attack-on-titan','أرمين','anilist:Armin Arlert',3,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:levi','attack-on-titan','ليفاي','anilist:Levi Ackerman',4,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:hange','attack-on-titan','هانجي','anilist:Hange Zoe',5,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:erwin','attack-on-titan','إروين','anilist:Erwin Smith',6,1,unixepoch()*1000,unixepoch()*1000),
  ('attack-on-titan:reiner','attack-on-titan','راينر','anilist:Reiner Braun',7,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('demon-slayer', NULL, 'قاتل الشياطين', 'demon-slayer', 5, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('demon-slayer:tanjiro','demon-slayer','تانجيرو','anilist:Tanjiro Kamado',1,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:nezuko','demon-slayer','نيزوكو','anilist:Nezuko Kamado',2,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:zenitsu','demon-slayer','زينيتسو','anilist:Zenitsu Agatsuma',3,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:inosuke','demon-slayer','إينوسكي','anilist:Inosuke Hashibira',4,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:giyu','demon-slayer','غيو','anilist:Giyu Tomioka',5,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:rengoku','demon-slayer','رينغوكو','anilist:Kyojuro Rengoku',6,1,unixepoch()*1000,unixepoch()*1000),
  ('demon-slayer:shinobu','demon-slayer','شينوبو','anilist:Shinobu Kocho',7,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('jujutsu-kaisen', NULL, 'جوجوتسو كايسن', 'jujutsu-kaisen', 6, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('jujutsu-kaisen:yuji','jujutsu-kaisen','يوجي','anilist:Yuji Itadori',1,1,unixepoch()*1000,unixepoch()*1000),
  ('jujutsu-kaisen:megumi','jujutsu-kaisen','ميغومي','anilist:Megumi Fushiguro',2,1,unixepoch()*1000,unixepoch()*1000),
  ('jujutsu-kaisen:nobara','jujutsu-kaisen','نوبارا','anilist:Nobara Kugisaki',3,1,unixepoch()*1000,unixepoch()*1000),
  ('jujutsu-kaisen:gojo','jujutsu-kaisen','غوجو','anilist:Satoru Gojo',4,1,unixepoch()*1000,unixepoch()*1000),
  ('jujutsu-kaisen:maki','jujutsu-kaisen','ماكي','anilist:Maki Zenin',5,1,unixepoch()*1000,unixepoch()*1000),
  ('jujutsu-kaisen:sukuna','jujutsu-kaisen','سوكونا','anilist:Ryomen Sukuna',6,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('solo-leveling', NULL, 'سولو ليفلينغ', 'solo-leveling', 7, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('solo-leveling:jinwoo','solo-leveling','سونغ جين وو','anilist:Sung Jinwoo',1,1,unixepoch()*1000,unixepoch()*1000),
  ('solo-leveling:cha-hae-in','solo-leveling','تشا هاي إن','anilist:Cha Hae-In',2,1,unixepoch()*1000,unixepoch()*1000),
  ('solo-leveling:jinho','solo-leveling','يو جين هو','anilist:Yoo Jinho',3,1,unixepoch()*1000,unixepoch()*1000),
  ('solo-leveling:igris','solo-leveling','إيغريس','anilist:Igris',4,1,unixepoch()*1000,unixepoch()*1000),
  ('solo-leveling:beru','solo-leveling','بيرو','anilist:Beru',5,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('hunter-x-hunter', NULL, 'هنتر × هنتر', 'hunter-x-hunter', 8, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('hunter-x-hunter:gon','hunter-x-hunter','غون','anilist:Gon Freecss',1,1,unixepoch()*1000,unixepoch()*1000),
  ('hunter-x-hunter:killua','hunter-x-hunter','كيلوا','anilist:Killua Zoldyck',2,1,unixepoch()*1000,unixepoch()*1000),
  ('hunter-x-hunter:kurapika','hunter-x-hunter','كورابيكا','anilist:Kurapika',3,1,unixepoch()*1000,unixepoch()*1000),
  ('hunter-x-hunter:leorio','hunter-x-hunter','ليوريو','anilist:Leorio Paradinight',4,1,unixepoch()*1000,unixepoch()*1000),
  ('hunter-x-hunter:hisoka','hunter-x-hunter','هيسوكا','anilist:Hisoka Morow',5,1,unixepoch()*1000,unixepoch()*1000),
  ('hunter-x-hunter:chrollo','hunter-x-hunter','كرولو','anilist:Chrollo Lucilfer',6,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('my-hero-academia', NULL, 'أكاديمية بطلي', 'my-hero-academia', 9, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('my-hero-academia:deku','my-hero-academia','ديكو','anilist:Izuku Midoriya',1,1,unixepoch()*1000,unixepoch()*1000),
  ('my-hero-academia:bakugo','my-hero-academia','باكوغو','anilist:Katsuki Bakugo',2,1,unixepoch()*1000,unixepoch()*1000),
  ('my-hero-academia:todoroki','my-hero-academia','تودوروكي','anilist:Shoto Todoroki',3,1,unixepoch()*1000,unixepoch()*1000),
  ('my-hero-academia:uraraka','my-hero-academia','أوراراكا','anilist:Ochaco Uraraka',4,1,unixepoch()*1000,unixepoch()*1000),
  ('my-hero-academia:all-might','my-hero-academia','أول مايت','anilist:All Might',5,1,unixepoch()*1000,unixepoch()*1000),
  ('my-hero-academia:tsuyu','my-hero-academia','تسويو','anilist:Tsuyu Asui',6,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO avatar_series
  (id, work_id, name, slug, position, is_active, created_at, updated_at)
VALUES ('fullmetal-alchemist', NULL, 'الخيميائي الفولاذي', 'fullmetal-alchemist', 10, 1, unixepoch()*1000, unixepoch()*1000);
INSERT OR IGNORE INTO avatars (id, series_id, character_name, image_path, position, is_active, created_at, updated_at) VALUES
  ('fullmetal-alchemist:edward','fullmetal-alchemist','إدوارد','anilist:Edward Elric',1,1,unixepoch()*1000,unixepoch()*1000),
  ('fullmetal-alchemist:alphonse','fullmetal-alchemist','ألفونس','anilist:Alphonse Elric',2,1,unixepoch()*1000,unixepoch()*1000),
  ('fullmetal-alchemist:roy','fullmetal-alchemist','روي','anilist:Roy Mustang',3,1,unixepoch()*1000,unixepoch()*1000),
  ('fullmetal-alchemist:riza','fullmetal-alchemist','ريزا','anilist:Riza Hawkeye',4,1,unixepoch()*1000,unixepoch()*1000),
  ('fullmetal-alchemist:winry','fullmetal-alchemist','وينري','anilist:Winry Rockbell',5,1,unixepoch()*1000,unixepoch()*1000),
  ('fullmetal-alchemist:scar','fullmetal-alchemist','سكار','anilist:Scar',6,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '9');
