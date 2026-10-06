import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import base64

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('numeric_migration', ROOT / 'scripts/migrate-numeric-user-ids.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SCHEMA = '''
CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO schema_meta VALUES('schema_version','19');
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,name TEXT,
 password_salt TEXT,password_hash TEXT,password_iterations INTEGER,role TEXT,created_at INTEGER,updated_at INTEGER,private_setting TEXT,profile_visibility TEXT DEFAULT 'private',avatar_id TEXT);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER,last_seen_at INTEGER,expires_at INTEGER);
CREATE TABLE favorites(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,manga_id TEXT,created_at INTEGER,PRIMARY KEY(user_id,manga_id));
CREATE TABLE reading_progress(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,manga_id TEXT,chapter REAL,percent REAL,completed INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,manga_id,chapter));
CREATE TABLE user_state(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_manga_id TEXT,last_chapter REAL,updated_at INTEGER);
CREATE TABLE user_library(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,manga_id TEXT,status TEXT,added_at INTEGER,updated_at INTEGER,last_read_at INTEGER,last_read_chapter REAL,highest_reached_chapter REAL,PRIMARY KEY(user_id,manga_id));
CREATE TABLE reading_history(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,manga_id TEXT,chapter REAL,read_at INTEGER,entry_type TEXT);
CREATE TABLE user_lists(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT);
CREATE TABLE user_list_items(list_id TEXT REFERENCES user_lists(id) ON DELETE CASCADE,manga_id TEXT,position REAL,PRIMARY KEY(list_id,manga_id));
CREATE TABLE user_profile_sections(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,section_type TEXT,reference_id TEXT,position REAL,is_visible INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,section_type,reference_id));
CREATE TABLE friendships(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,friend_id TEXT REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER,PRIMARY KEY(user_id,friend_id),CHECK(user_id<>friend_id));
CREATE TABLE friend_requests(pair_low_id TEXT,pair_high_id TEXT,requester_id TEXT REFERENCES users(id) ON DELETE CASCADE,receiver_id TEXT REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER,PRIMARY KEY(pair_low_id,pair_high_id),CHECK(pair_low_id<>pair_high_id),CHECK(requester_id<>receiver_id),CHECK((requester_id=pair_low_id AND receiver_id=pair_high_id) OR (requester_id=pair_high_id AND receiver_id=pair_low_id)));
CREATE TABLE activity_events(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,list_id TEXT REFERENCES user_lists(id) ON DELETE CASCADE,type TEXT,created_at INTEGER);
CREATE TABLE admin_audit_log(id INTEGER PRIMARY KEY,admin_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT,created_at INTEGER);
CREATE TABLE account_recovery(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,recovery_salt TEXT,recovery_hash TEXT,recovery_iterations INTEGER,created_at INTEGER);
CREATE TABLE work_snapshots(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,manga_id TEXT,title TEXT,cover_content_type TEXT DEFAULT 'image/png',cover_size INTEGER,cover_source_url TEXT,last_read_at INTEGER,last_read_chapter REAL,highest_reached_chapter REAL,created_at INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,manga_id));
CREATE TABLE work_snapshot_cover_chunks(user_id TEXT,manga_id TEXT,chunk_index INTEGER,data BLOB,PRIMARY KEY(user_id,manga_id,chunk_index),FOREIGN KEY(user_id,manga_id) REFERENCES work_snapshots(user_id,manga_id) ON DELETE CASCADE);
'''

CONFIG = {'accounts': [
 {'username': 'h', 'source_ids': ['has','h'], 'primary_id': 'has'},
 {'username': 'y', 'source_ids': ['yas','y'], 'primary_id': 'yas'},
 {'username': 'm', 'source_ids': ['m'], 'primary_id': 'm'},
 {'username': 'admin', 'source_ids': ['admin'], 'primary_id': 'admin'},
]}

def fixture(path):
    db = sqlite3.connect(':memory:')
    db.executescript(SCHEMA)
    for i, old in enumerate(['has','h','yas','y','m','admin']):
        salt = bytes([i + 1]) * 16
        password = old + '-before'
        hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 25000)
        encode = lambda v: base64.urlsafe_b64encode(v).decode().rstrip('=')
        db.execute('INSERT INTO users(id,username,name,password_salt,password_hash,password_iterations,role,created_at,updated_at,private_setting) VALUES(?,?,?,?,?,?,?,?,?,?)', (old, '__wany_admin__' if old == 'admin' else old, old, encode(salt), encode(hashed),25000,'admin' if old=='admin' else 'user',1,2,old+'-setting'))
    db.executescript('''
    INSERT INTO sessions VALUES('session','has',1,1,9999999999999);
    INSERT INTO user_library VALUES('has','story','paused',100,110,100,5,30),('h','story','reading',50,220,200,10,20),('h','other','planned',20,20,NULL,NULL,NULL);
    INSERT INTO favorites VALUES('has','story',100),('h','story',50);
    INSERT INTO reading_progress VALUES('has','story',5,20,0,300),('h','story',5,90,1,200);
    INSERT INTO user_state VALUES('has','story',5,100),('h','other',9,300);
    INSERT INTO reading_history VALUES(1,'has','story',5,100,'organic'),(2,'h','story',10,200,'organic'),(3,'yas','story',12,300,'bulk');
    INSERT INTO user_lists VALUES('list1','has','List 1'),('list2','h','List 2');
    INSERT INTO user_list_items VALUES('list1','story',1),('list2','other',1);
    INSERT INTO user_profile_sections VALUES('has','favorites','',1,1,100),('h','favorites','',2,0,200);
    INSERT INTO friendships VALUES('has','m',100),('h','m',200),('m','has',100),('m','h',200),('has','h',100),('h','has',100);
    INSERT INTO friend_requests VALUES('m','yas','yas','m',100),('m','y','y','m',200),('h','has','has','h',100);
    INSERT INTO activity_events VALUES(1,'has','list1','created_list',100),(2,'h','list2','created_list',200);
    INSERT INTO admin_audit_log VALUES(1,'admin','has','view_private_user',100),(2,'admin',NULL,'admin_login',200);
    INSERT INTO work_snapshots(user_id,manga_id,title,cover_size,cover_source_url,last_read_at,last_read_chapter,highest_reached_chapter,created_at,updated_at) VALUES('has','story','Story A',110000,'cover-A',100,5,40,10,500),('h','story','Story B',110000,'cover-B',300,10,50,20,200);
    ''')
    db.execute('INSERT INTO work_snapshot_cover_chunks VALUES(?,?,?,?)', ('has','story',0,b'A'*110000))
    db.execute('INSERT INTO work_snapshot_cover_chunks VALUES(?,?,?,?)', ('h','story',0,b'B'*110000))
    db.commit()
    path.write_text('\n'.join(db.iterdump()))
    db.close()

class NumericIdentityMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.backup = self.root / 'backup.sql'
        fixture(self.backup)
        self.original = self.backup.read_bytes()

    def tearDown(self): self.temp.cleanup()

    def plan(self):
        output = self.root / 'private'
        report = m.build_plan(self.backup, CONFIG, output)
        db = sqlite3.connect(output / 'migrated.sqlite'); db.row_factory = sqlite3.Row
        mapping = json.loads((output / 'mapping.local.json').read_text())
        self.addCleanup(db.close)
        return output, report, db, mapping

    def test_data_and_private_export_survive_merge_and_rollback(self):
        output, report, db, ids = self.plan()
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(report['accounts_after'],4)
        self.assertEqual(ids['has'],ids['h']); self.assertEqual(ids['yas'],ids['y'])
        for row in db.execute('SELECT id,typeof(id),username FROM users'):
            self.assertRegex(row[0], r'^[1-9][0-9]{31}$'); self.assertEqual(row[1],'text')
        row = db.execute('SELECT * FROM user_library WHERE user_id=? AND manga_id=?', (ids['has'],'story')).fetchone()
        self.assertEqual((row['highest_reached_chapter'],row['last_read_chapter'],row['last_read_at'],row['status']), (30,10,200,'reading'))
        self.assertEqual(tuple(db.execute('SELECT percent,completed,updated_at FROM reading_progress').fetchone()),(90,1,300))
        self.assertEqual(db.execute('SELECT count(*) FROM reading_history').fetchone()[0],3)
        self.assertEqual(db.execute('SELECT count(*) FROM user_list_items').fetchone()[0],2)
        self.assertEqual(db.execute('SELECT count(*) FROM activity_events').fetchone()[0],2)
        self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
        self.assertEqual(db.execute('SELECT private_setting FROM users WHERE id=?',(ids['has'],)).fetchone()[0],'has-setting')
        self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])
        self.assertTrue(report['apply_and_rollback_verified_locally'])

    def test_cover_blobs_and_preferred_r2_paths_survive(self):
        output, report, db, ids = self.plan()
        self.assertEqual(db.execute('SELECT data FROM work_snapshot_cover_chunks').fetchone()[0],b'A'*110000)
        self.assertEqual(db.execute('SELECT r2_user_id FROM work_snapshot_cover_locations').fetchone()[0],'has')
        self.assertEqual(db.execute('SELECT highest_reached_chapter,last_read_chapter FROM work_snapshots').fetchone()[0],50)
        self.assertEqual({r[0] for r in db.execute('SELECT old_user_id FROM user_identity_aliases WHERE user_id=?',(ids['has'],))},{'h','has'})

    def test_social_pairs_are_sorted_and_self_relations_removed(self):
        output, report, db, ids = self.plan()
        self.assertEqual(db.execute('SELECT count(*) FROM friendships').fetchone()[0],2)
        request = db.execute('SELECT * FROM friend_requests').fetchone()
        self.assertEqual(request['pair_low_id'],min(ids['yas'],ids['m']))
        self.assertEqual(request['pair_high_id'],max(ids['yas'],ids['m']))
        self.assertEqual(request['created_at'],200)

    def test_old_passwords_are_preserved_in_database_verifiers(self):
        output, report, db, ids = self.plan()
        rows = list(db.execute('SELECT password_hash FROM user_password_verifiers WHERE user_id=?',(ids['has'],)))
        self.assertEqual(len(rows),2)
        self.assertEqual(db.execute('SELECT role FROM users WHERE username=?',('admin',)).fetchone()[0],'admin')

    def test_rollback_refuses_new_reading_data_and_keeps_it(self):
        output, report, db, ids = self.plan()
        db.execute('INSERT INTO reading_history VALUES(99,?,?,?, ?,?)',(ids['has'],'new-story',99,999,'organic')); db.commit()
        with self.assertRaises(sqlite3.IntegrityError): m.apply_atomic(db,(output/'rollback.sql').read_text())
        self.assertEqual(db.execute('SELECT count(*) FROM reading_history WHERE id=99').fetchone()[0],1)
        self.assertEqual(db.execute('SELECT id FROM users WHERE username=?',('h',)).fetchone()[0],ids['has'])

    def test_stale_apply_refuses_without_partial_writes(self):
        output, report, db, ids = self.plan()
        original = m.load_backup(self.backup)
        self.addCleanup(original.close)
        original.execute("UPDATE user_library SET last_read_at=1000 WHERE user_id='has'"); original.commit()
        with self.assertRaises(sqlite3.IntegrityError): m.apply_atomic(original,(output/'apply.sql').read_text())
        self.assertEqual(original.execute("SELECT last_read_at FROM user_library WHERE user_id='has'").fetchone()[0],1000)
        self.assertEqual(original.execute('SELECT count(*) FROM users').fetchone()[0],6)

    def test_unknown_conflicting_table_requires_review(self):
        with self.backup.open('a') as f:
            f.write("\nCREATE TABLE unknown_setting(user_id TEXT PRIMARY KEY REFERENCES users(id),value TEXT); INSERT INTO unknown_setting VALUES('has','one'),('h','two');")
        with self.assertRaises(m.MigrationError): m.build_plan(self.backup,CONFIG,self.root/'private')
        self.assertFalse((self.root/'private').exists())

    def test_no_hardcoded_grouping_or_omitted_accounts(self):
        config = {'accounts':CONFIG['accounts'][:-1]}
        with self.assertRaises(m.MigrationError): m.build_plan(self.backup,config,self.root/'private')
        config = json.loads(json.dumps(CONFIG)); config['accounts'][0]['source_ids'].append('admin')
        with self.assertRaises(m.MigrationError): m.build_plan(self.backup,config,self.root/'private')

    def test_new_schema_or_trigger_blocks_stale_apply(self):
        output, report, db, ids = self.plan()
        original = m.load_backup(self.backup); self.addCleanup(original.close)
        original.executescript("CREATE TABLE new_private_data(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, value TEXT); INSERT INTO new_private_data VALUES('has','keep');")
        with self.assertRaises(sqlite3.IntegrityError): m.apply_atomic(original,(output/'apply.sql').read_text())
        self.assertEqual(original.execute('SELECT value FROM new_private_data').fetchone()[0],'keep')

    def test_existing_numeric_ids_are_not_regenerated(self):
        output, report, db, ids = self.plan()
        migrated = self.root / 'migrated.sql'; migrated.write_text('\n'.join(db.iterdump()))
        config = m.template(migrated)
        with self.assertRaisesRegex(m.MigrationError,'already have stable numeric IDs'):
            m.build_plan(migrated,config,self.root/'again')

if __name__ == '__main__': unittest.main()
