"""Inspect a D1 SQL export locally. Never connect to Cloudflare or print credentials."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def inspect_backup(path):
    source = Path(path).read_bytes()
    db = sqlite3.connect(':memory:')
    # An export may create/insert its own data, but may not access other files.
    def authorize(action, arg1, arg2, database, trigger):
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() == 'load_extension':
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    db.set_authorizer(authorize)
    db.executescript(source.decode('utf-8-sig'))
    db.execute('PRAGMA query_only = ON')
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    if 'users' not in tables:
        raise ValueError('The export does not contain users.')
    columns = {t: [r[1] for r in db.execute(f'PRAGMA table_info({quote(t)})')] for t in tables}
    safe = [c for c in ('id', 'username', 'name', 'role', 'password_iterations') if c in columns['users']]
    users = [dict(zip(safe, r)) for r in db.execute(f'SELECT {", ".join(map(quote, safe))} FROM users ORDER BY username')]
    duplicates = [dict(username=r[0], count=r[1]) for r in db.execute('SELECT lower(trim(username)), count(*) FROM users GROUP BY lower(trim(username)) HAVING count(*) > 1')]
    references = {}
    for table in tables:
        for column in columns[table]:
            if column not in ('user_id', 'friend_id', 'requester_id', 'receiver_id', 'pair_low_id', 'pair_high_id', 'admin_user_id', 'target_user_id'):
                continue
            t, c = quote(table), quote(column)
            counts = {str(r[0]): r[1] for r in db.execute(f'SELECT {c}, count(*) FROM {t} WHERE {c} IS NOT NULL GROUP BY {c}')}
            orphan_count = db.execute(f'SELECT count(*) FROM {t} t LEFT JOIN users u ON u.id=t.{c} WHERE t.{c} IS NOT NULL AND u.id IS NULL').fetchone()[0]
            references[f'{table}.{column}'] = {'counts': counts, 'orphan_count': orphan_count}
    version = None
    if 'schema_meta' in tables:
        row = db.execute("SELECT value FROM schema_meta WHERE key='schema_version'").fetchone()
        version = row[0] if row else None
    result = {
        'backup_sha256': hashlib.sha256(source).hexdigest(),
        'schema_version': version,
        'users': users,
        'duplicate_login_names': duplicates,
        'tables_and_columns': columns,
        'references': references,
        'foreign_key_violations': [list(r) for r in db.execute('PRAGMA foreign_key_check')],
        'legacy_pairs': {name: [u for u in users if str(u['id']).lower() in ids] for name, ids in [('H', ('h', 'has')), ('Y', ('y', 'yas'))]},
        'r2_note': 'This export cannot verify R2 objects. Keep all old covers/<userId>/ keys until a reviewed merge and cover validation complete.',
    }
    db.close()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', help='Path to wany-backup.sql')
    args = parser.parse_args()
    print(json.dumps(inspect_backup(args.backup), ensure_ascii=False, indent=2))
