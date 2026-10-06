import runpy
from pathlib import Path
import sqlite3
import tempfile

root = Path(__file__).resolve().parent.parent
prepare = runpy.run_path(str(root / 'scripts/prepare-source-schema.py'))['prepare']
migration = (root / 'migrations/0016_source_schema.sql').read_text()
with tempfile.TemporaryDirectory() as temp:
    for mode in ['empty', 'old', 'current']:
        path = Path(temp) / (mode + '.sqlite')
        db = sqlite3.connect(path)
        db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT)')
        db.execute("INSERT INTO users VALUES ('fixture', 'synthetic-secret')")
        if mode != 'empty':
            schema = migration.split('UPDATE source_items')[0]
            if mode == 'old':
                schema = schema.replace('  first_seen_at INTEGER,\n', '').replace('  is_baseline INTEGER NOT NULL DEFAULT 0,\n', '')
            db.executescript(schema)
            db.execute("INSERT INTO source_items (source_key,source,source_id,slug,title,updated_at) VALUES ('s:1','s','1','slug','title',123)")
            db.execute("INSERT INTO source_chapter_seen (source_key,chapter_identity,chapter_number,first_seen_at) VALUES ('s:1','one',1,124)")
            db.execute("INSERT INTO source_sync_state VALUES ('s',125)")
        db.commit()
        before = path.read_bytes()
        sql = prepare(path)
        assert path.read_bytes() == before, 'generator must not modify input'
        assert 'synthetic-secret' not in sql
        db.executescript(sql)
        assert db.execute('SELECT * FROM users').fetchall() == [('fixture', 'synthetic-secret')]
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        if mode != 'empty':
            assert db.execute('SELECT first_seen_at FROM source_items').fetchall() == [(123,)]
            assert db.execute('SELECT chapter_number,first_seen_at,is_baseline FROM source_chapter_seen').fetchall() == [(1,124,0)]
            assert db.execute('SELECT * FROM source_sync_state').fetchall() == [('s',125)]
        db.commit()
        before = list(db.iterdump())
        db.executescript(prepare(path))
        assert list(db.iterdump()) == before, 'prepared migration must be repeatable'
        db.close()
    path = Path(temp) / 'unsupported.sqlite'
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE source_items (source_key TEXT)')
    db.commit()
    db.close()
    try:
        prepare(path)
        raise AssertionError('unexpected schema must be refused')
    except ValueError:
        pass
print('empty, old, current, repeat apply and unsupported schema checks passed')
