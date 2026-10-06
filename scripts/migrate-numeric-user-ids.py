"""Build and verify private numeric-ID migrations offline. Never contact Cloudflare."""
import argparse
import base64
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import time
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
SUPPORT_SQL = (ROOT / 'migrations/0015_numeric_identity_support.sql').read_text()
SUPPORT_TABLES = {'user_identity_aliases', 'work_snapshot_cover_locations', 'user_password_verifiers', 'user_recovery_verifiers', 'account_recovery', 'auth_attempt_windows', 'user_security_questions'}
USER_COLUMNS = {'user_id', 'friend_id', 'requester_id', 'receiver_id', 'pair_low_id', 'pair_high_id', 'admin_user_id', 'target_user_id'}

class MigrationError(ValueError):
    pass


def q(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    if value is None: return 'NULL'
    if isinstance(value, bytes): return "X'" + value.hex() + "'"
    if isinstance(value, str): return "'" + value.replace("'", "''") + "'"
    if isinstance(value, (int, float)) and math.isfinite(value): return repr(value)
    raise MigrationError('Unsupported SQLite value type.')


def numeric_id():
    return str(secrets.randbelow(9) + 1) + ''.join(str(secrets.randbelow(10)) for _ in range(31))


def normalize_name(value):
    return unicodedata.normalize('NFKC', value).strip().lower()


def load_backup(path):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    def authorize(action, arg1, arg2, database, trigger):
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH): return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() == 'load_extension': return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    db.set_authorizer(authorize)
    db.executescript(Path(path).read_text(encoding='utf-8-sig'))
    return db


def catalog(db):
    names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {name: {
        'sql': db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()[0],
        'columns': [r[1] for r in db.execute(f'PRAGMA table_info({q(name)})')],
        'pk': [r[1] for r in sorted(db.execute(f'PRAGMA table_info({q(name)})'), key=lambda r: r[5]) if r[5]],
        'fk': [dict(r) for r in db.execute(f'PRAGMA foreign_key_list({q(name)})')],
        'rows': [dict(r) for r in db.execute(f'SELECT * FROM {q(name)}')],
    } for name in names}


def user_columns(name, table):
    # Historic pair fields have no FK. Arbitrary new user FKs are discovered too.
    fields = set(table['columns']) & USER_COLUMNS
    fields |= {r['from'] for r in table['fk'] if r['table'] == 'users' and r['to'] == 'id'}
    return fields


def checked_accounts(data, config):
    if 'users' not in data or 'schema_meta' not in data or 'work_snapshots' not in data:
        raise MigrationError('A complete runtime-v19 export including users and work_snapshots is required.')
    version = next((r['value'] for r in data['schema_meta']['rows'] if r['key'] == 'schema_version'), None)
    if version is None or int(version) < 19:
        raise MigrationError('Explicit schema preparation to v19 is required; do not edit the version marker alone.')
    users = {str(r['id']): r for r in data['users']['rows']}
    accounts = config.get('accounts', [])
    seen, names = set(), set()
    reserved = set(users) | {str(r['old_user_id']) for r in data.get('user_identity_aliases', {}).get('rows', [])}
    mapping, primaries, new_users = {}, {}, []
    for account in accounts:
        sources = account.get('source_ids', [])
        primary = account.get('primary_id')
        username = normalize_name(account.get('username', ''))
        if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,31}', username):
            raise MigrationError('Invalid canonical username in the private account manifest.')
        if username in names or not sources or len(set(sources)) != len(sources) or primary not in sources:
            raise MigrationError('Every account needs a unique username, explicit primary_id and distinct source_ids.')
        if any(not isinstance(old, str) or old not in users or old in seen for old in sources):
            raise MigrationError('Source IDs must exist and belong to exactly one reviewed account group.')
        roles = {users[old].get('role', 'user') for old in sources}
        if len(roles) != 1:
            raise MigrationError('Cannot merge accounts with different roles.')
        new = primary if re.fullmatch(r'[1-9][0-9]{31}', primary) else numeric_id()
        while new in reserved and new != primary: new = numeric_id()
        reserved.add(new)
        for old in sources: mapping[old] = new
        primaries[new] = primary
        row = dict(users[primary])
        row['id'], row['username'] = new, username
        if 'created_at' in row: row['created_at'] = min(users[old]['created_at'] for old in sources)
        # Credential fields, role and settings come from the explicitly chosen primary.
        new_users.append(row)
        seen.update(sources)
        names.add(username)
    if seen != set(users):
        raise MigrationError('The manifest must include every existing account; none may be silently dropped.')
    if all(old == new for old, new in mapping.items()) and all(len(a['source_ids']) == 1 for a in accounts) and all(users[r['id']]['username'] == r['username'] for r in new_users) and int(version) >= 20:
        raise MigrationError('All accounts already have stable numeric IDs. No identity migration is needed.')
    return mapping, primaries, new_users


def maximum(records, field):
    values = [r['row'].get(field) for r in records if r['row'].get(field) is not None]
    return max(values) if values else None


def winner(records, primaries, *fields):
    def score(record):
        row = record['row']
        return tuple(row.get(f) or 0 for f in fields) + (record['origin'] == primaries.get(row.get('user_id')),)
    return max(records, key=score)


def merged_row(table, records, primaries):
    if len(records) == 1: return dict(records[0]['row'])
    if all(r['row'] == records[0]['row'] for r in records): return dict(records[0]['row'])
    selected = winner(records, primaries, 'updated_at', 'created_at')
    row = dict(selected['row'])
    if table == 'favorites': row['created_at'] = min(r['row']['created_at'] for r in records)
    elif table == 'reading_progress':
        for field in ('percent', 'completed', 'updated_at'): row[field] = maximum(records, field)
    elif table in ('user_library', 'work_snapshots'):
        if table == 'work_snapshots':
            cover_records = [r for r in records if r['row'].get('cover_size', 0) > 0] or records
            row = dict(winner(cover_records, primaries, 'updated_at')['row'])
        last = winner(records, primaries, 'last_read_at')['row']
        for field in ('last_read_at', 'last_read_chapter'):
            if field in row: row[field] = last.get(field)
        if 'highest_reached_chapter' in row: row['highest_reached_chapter'] = maximum(records, 'highest_reached_chapter')
        if 'updated_at' in row: row['updated_at'] = maximum(records, 'updated_at')
        if 'added_at' in row: row['added_at'] = min(r['row']['added_at'] for r in records)
        if 'created_at' in row: row['created_at'] = min(r['row']['created_at'] for r in records)
    elif table in ('user_state', 'user_profile_sections'):
        row = dict(winner(records, primaries, 'updated_at')['row'])
    elif table == 'friendships': row['created_at'] = min(r['row']['created_at'] for r in records)
    elif table == 'friend_requests': row = dict(winner(records, primaries, 'created_at')['row'])
    elif table == 'account_recovery': row = dict(winner(records, primaries)['row'])
    else:
        raise MigrationError(f'Conflicting rows in {table}; a reviewed merge rule is required. No migration was applied.')
    return row


def transform(original, support, config):
    mapping, primaries, new_users = checked_accounts(original, config)
    all_data = {**original, **{t: support[t] for t in SUPPORT_TABLES if t not in original}}
    changed = {'users', 'schema_meta'} | SUPPORT_TABLES
    changed |= {name for name, table in all_data.items() if user_columns(name, table)}
    while True:
        expanded = changed | {name for name, table in all_data.items() if any(fk['table'] in changed for fk in table['fk'])}
        if expanded == changed: break
        changed = expanded
    desired = {name: [dict(r) for r in table['rows']] for name, table in all_data.items()}
    selected_covers = {}
    snapshot_groups = defaultdict(list)
    for row in original['work_snapshots']['rows']:
        copy = dict(row); copy['user_id'] = mapping[str(row['user_id'])]
        snapshot_groups[(copy['user_id'], copy['manga_id'])].append({'row': copy, 'origin': str(row['user_id'])})
    old_locations = {(r['user_id'], r['manga_id']): r['r2_user_id'] for r in original.get('work_snapshot_cover_locations', {}).get('rows', [])}
    for key, records in snapshot_groups.items():
        covered = [r for r in records if r['row'].get('cover_size', 0) > 0] or records
        selected = winner(covered, primaries, 'updated_at')
        selected_covers[key] = selected['origin']
    dropped_self, collisions = {}, {}
    for name in sorted(changed - {'users', 'schema_meta'}):
        table = all_data[name]
        grouped = defaultdict(list)
        fields = user_columns(name, table)
        dropped = 0
        for index, old in enumerate(table['rows']):
            row = dict(old)
            origin = str(row.get('user_id', ''))
            for field in fields:
                if row.get(field) is not None:
                    value = str(row[field])
                    if value not in mapping: raise MigrationError(f'Orphan account reference in {name}.{field}.')
                    row[field] = mapping[value]
            if name == 'sessions' and str(old['user_id']) != mapping[str(old['user_id'])]: continue
            if name == 'work_snapshot_cover_chunks' and origin != selected_covers.get((row['user_id'], row['manga_id'])): continue
            if name == 'friendships' and row['user_id'] == row['friend_id']:
                dropped += 1; continue
            if name == 'friend_requests':
                if row['requester_id'] == row['receiver_id']:
                    dropped += 1; continue
                row['pair_low_id'], row['pair_high_id'] = sorted((row['requester_id'], row['receiver_id']))
            key = tuple(row[c] for c in table['pk']) if table['pk'] else ('row', index)
            grouped[key].append({'row': row, 'origin': origin})
        desired[name] = [merged_row(name, rows, primaries) for rows in grouped.values()]
        collisions[name] = sum(len(rows) - 1 for rows in grouped.values())
        if dropped: dropped_self[name] = dropped
    desired['users'] = new_users
    desired['schema_meta'] = [dict(r, value='20') if r['key'] == 'schema_version' else dict(r) for r in original['schema_meta']['rows']]
    now = int(time.time() * 1000)
    for old, new in mapping.items():
        if old != new:
            desired['user_identity_aliases'].append({'old_user_id': old, 'user_id': new, 'created_at': now})
    desired['work_snapshot_cover_locations'] = [
        {'user_id': key[0], 'manga_id': key[1], 'r2_user_id': old_locations.get((old, key[1]), old)}
        for key, old in selected_covers.items()]
    # Never carry credentials or recovery codes from a possibly exposed legacy system.
    # Fresh high-entropy secrets exist only in private output files on this computer.
    credentials = []
    desired['sessions'] = []
    desired['account_recovery'] = []
    desired['user_password_verifiers'] = []
    desired['user_recovery_verifiers'] = []
    for user in new_users:
        password = secrets.token_urlsafe(24)
        recovery_code = secrets.token_urlsafe(32)
        salt = secrets.token_bytes(16)
        user['password_salt'] = base64.urlsafe_b64encode(salt).decode().rstrip('=')
        user['password_hash'] = base64.urlsafe_b64encode(hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)).decode().rstrip('=')
        user['password_iterations'] = 100000
        user['updated_at'] = now
        desired['user_recovery_verifiers'].append({
            'user_id': user['id'], 'scheme': 'sha256', 'recovery_salt': '',
            'recovery_hash': base64.urlsafe_b64encode(hashlib.sha256(recovery_code.encode()).digest()).decode().rstrip('='),
            'recovery_iterations': 1})
        credentials.append({'user_id': user['id'], 'username': user['username'],
            'password': password, 'recoveryCode': recovery_code})
    # Reconcile existing aliases/verifiers without dropping a conflicting owner.
    for name in SUPPORT_TABLES:
        keyed = {}
        for row in desired[name]:
            key = tuple(row[c] for c in all_data[name]['pk'])
            if key in keyed and keyed[key] != row:
                if name == 'user_identity_aliases' and keyed[key]['user_id'] == row['user_id']: continue
                raise MigrationError(f'Conflicting migration metadata in {name}.')
            keyed[key] = row
        desired[name] = list(keyed.values())
    return all_data, desired, changed, mapping, collisions, dropped_self, credentials


def insert_statements(name, columns, pk, row):
    blobs = {c: value for c, value in row.items() if isinstance(value, bytes) and value}
    initial = {**row, **{c: b'' for c in blobs}}
    statements = [f'INSERT INTO {q(name)} ({", ".join(map(q, columns))}) VALUES ({", ".join(literal(initial[c]) for c in columns)});']
    if blobs and not pk: raise MigrationError(f'BLOB table {name} requires a primary key for safe chunked inserts.')
    condition = ' AND '.join(f'{q(c)} IS {literal(row[c])}' for c in pk)
    for column, value in blobs.items():
        for offset in range(0, len(value), 8192):
            statements.append(f'UPDATE {q(name)} SET {q(column)} = CAST({q(column)} || {literal(value[offset:offset+8192])} AS BLOB) WHERE {condition};')
    return statements


def ordered_tables(tables, catalog_data):
    remaining, order = set(tables), []
    while remaining:
        ready = sorted(name for name in remaining if not any(f['table'] in remaining and f['table'] != name for f in catalog_data[name]['fk']))
        if not ready: raise MigrationError('Cyclic account foreign keys require a reviewed migration.')
        order.extend(ready); remaining.difference_update(ready)
    return order


def guard_statements(name, columns, pk, rows, guard, prefix):
    result = []
    def check(key, condition):
        result.append(f'INSERT INTO {q(guard)} (key, ok) SELECT {literal(key)}, CASE WHEN ({condition}) THEN 1 ELSE 0 END;')
    check(prefix + '-count', f'SELECT COUNT(*) = {len(rows)} FROM {q(name)}')
    unique = Counter(tuple(r[c] for c in columns) for r in rows)
    for index, (values, multiplicity) in enumerate(unique.items()):
        row = dict(zip(columns, values))
        regular = [f'{q(c)} IS {literal(row[c])}' for c in columns if not isinstance(row[c], bytes)]
        blobs = {c: v for c, v in row.items() if isinstance(v, bytes)}
        regular.extend(f'length({q(c)}) = {len(v)}' for c, v in blobs.items())
        check(f'{prefix}-{index}', f'SELECT COUNT(*) = {multiplicity} FROM {q(name)} WHERE ' + (' AND '.join(regular) or '1'))
        if blobs and not pk: raise MigrationError(f'Cannot guard a BLOB table without a primary key: {name}.')
        identity = ' AND '.join(f'{q(c)} IS {literal(row[c])}' for c in pk)
        for column, value in blobs.items():
            for offset in range(0, len(value), 8192):
                check(f'{prefix}-{index}-{column}-{offset}', f'SELECT COUNT(*) = 1 FROM {q(name)} WHERE {identity} AND substr({q(column)}, {offset+1}, 8192) IS {literal(value[offset:offset+8192])}')
    return result


def migration_sql(data, before, after, changed, label):
    guard = '_wany_numeric_id_guard_' + secrets.token_hex(6)
    order = ordered_tables(changed, data)
    statements = ['PRAGMA defer_foreign_keys = ON;', SUPPORT_SQL, f'CREATE TABLE {q(guard)} (key TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK (ok = 1));']
    regular = [name for name in data if not name.startswith('_cf_') and name not in ('d1_migrations', '_wany_identity_migrations')]
    excluded = ', '.join(map(literal, [guard, 'd1_migrations', '_wany_identity_migrations']))
    schema_count = f"SELECT COUNT(*) = {len(regular)} FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ({excluded})"
    statements.append(f"INSERT INTO {q(guard)} VALUES ('table-set', CASE WHEN ({schema_count}) THEN 1 ELSE 0 END);")
    for name in order:
        check_schema = f"SELECT COUNT(*) = 1 FROM sqlite_master WHERE type='table' AND name={literal(name)} AND sql IS {literal(data[name]['sql'])}"
        statements.append(f"INSERT INTO {q(guard)} VALUES ({literal(name+'-schema')}, CASE WHEN ({check_schema}) THEN 1 ELSE 0 END);")
        check_triggers = f"SELECT COUNT(*) = 0 FROM sqlite_master WHERE type='trigger' AND tbl_name={literal(name)}"
        statements.append(f"INSERT INTO {q(guard)} VALUES ({literal(name+'-triggers')}, CASE WHEN ({check_triggers}) THEN 1 ELSE 0 END);")
        statements.extend(guard_statements(name, data[name]['columns'], data[name]['pk'], before.get(name, []), guard, name + '-before'))
    for name in reversed(order): statements.append(f'DELETE FROM {q(name)};')
    for name in order:
        for row in after.get(name, []): statements.extend(insert_statements(name, data[name]['columns'], data[name]['pk'], row))
    for name in order:
        statements.extend(guard_statements(name, data[name]['columns'], data[name]['pk'], after.get(name, []), guard, name + '-after'))
    statements.append(f'DROP TABLE {q(guard)};')
    if any(len(statement.encode()) > 90000 for statement in statements):
        raise MigrationError('A statement exceeds the conservative D1 size limit; a tailored migration is required.')
    return '\n\n'.join([f'-- Private {label}. Apply only as ONE atomic D1 migration, with writes paused.', *statements]) + '\n'


def apply_atomic(db, sql):
    db.execute('PRAGMA foreign_keys = ON')
    try:
        db.executescript('BEGIN IMMEDIATE;\n' + sql + '\nCOMMIT;')
    except Exception:
        db.rollback()
        raise
    if list(db.execute('PRAGMA foreign_key_check')):
        raise MigrationError('Foreign key validation failed.')


def canonical_rows(rows):
    encode = lambda value: {'blob': value.hex()} if isinstance(value, bytes) else value
    return sorted(json.dumps({k: encode(v) for k, v in r.items()}, sort_keys=True, ensure_ascii=False) for r in rows)


def build_plan(backup, config, output):
    source = load_backup(backup)
    if list(source.execute('PRAGMA foreign_key_check')):
        raise MigrationError('Existing foreign key violations must be resolved locally before planning.')
    original = catalog(source)
    source.executescript(SUPPORT_SQL)
    support = catalog(source)
    data, desired, changed, mapping, collisions, dropped, credentials = transform(original, support, config)
    for trigger in source.execute("SELECT tbl_name FROM sqlite_master WHERE type='trigger'"):
        if trigger[0] in changed: raise MigrationError('An account-table trigger needs manual review before migration.')
    before = {name: original.get(name, {}).get('rows', []) for name in changed}
    apply_sql = migration_sql(data, before, desired, changed, 'numeric-ID transition')
    # Data rollback must NOT resurrect exposed credentials or authenticated sessions.
    rollback_rows = {name: [dict(row) for row in rows] for name, rows in before.items()}
    fresh_users = {row['id']: row for row in desired['users']}
    for user in rollback_rows['users']:
        fresh = fresh_users[mapping[str(user['id'])]]
        for field in ('password_salt', 'password_hash', 'password_iterations', 'updated_at'):
            user[field] = fresh[field]
    for name in ('sessions', 'account_recovery', 'user_password_verifiers'):
        rollback_rows[name] = []
    primary_by_new = {mapping[a['primary_id']]: a['primary_id'] for a in config['accounts']}
    rollback_rows['user_recovery_verifiers'] = [
        {**row, 'user_id': primary_by_new[row['user_id']]}
        for row in desired['user_recovery_verifiers']]
    rollback_sql = migration_sql(data, desired, rollback_rows, changed, 'guarded data rollback; credentials stay rotated')
    # Both directions are tested against the actual private export in memory.
    apply_atomic(source, apply_sql)
    actual = catalog(source)
    for name in changed:
        if canonical_rows(actual[name]['rows']) != canonical_rows(desired[name]): raise MigrationError(f'Unexpected transformed data in {name}.')
    transformed = sqlite3.connect(':memory:')
    source.backup(transformed)
    apply_atomic(source, rollback_sql)
    actual = catalog(source)
    for name in changed:
        if canonical_rows(actual[name]['rows']) != canonical_rows(rollback_rows[name]): raise MigrationError(f'Rollback mismatch in {name}.')
    folder = Path(output)
    folder.mkdir(parents=True, exist_ok=False)
    for name, content in [('apply.sql', apply_sql), ('rollback.sql', rollback_sql), ('mapping.local.json', json.dumps(mapping, indent=2)), ('credentials.local.json', json.dumps({'accounts': credentials}, indent=2))]:
        path = folder / name
        path.write_text(content, encoding='utf-8'); path.chmod(0o600)
    destination = sqlite3.connect(folder / 'migrated.sqlite')
    transformed.backup(destination); destination.close(); (folder / 'migrated.sqlite').chmod(0o600)
    report = {
        'accounts_before': len(original['users']['rows']), 'accounts_after': len(desired['users']),
        'all_credentials_rotated': True, 'all_old_sessions_revoked': True, 'rollback_keeps_fresh_credentials': True,
        'all_ids_are_numeric_text': all(isinstance(r['id'], str) and re.fullmatch(r'[1-9][0-9]{31}', r['id']) for r in desired['users']),
        'apply_and_rollback_verified_locally': True,
        'table_counts': {name: {'before': len(before[name]), 'after': len(desired[name])} for name in sorted(changed)},
        'reconciled_duplicate_rows': {k: v for k, v in collisions.items() if v}, 'removed_self_relationships': dropped,
        'r2': 'Old keys remain untouched. D1 stores owner-scoped aliases and preferred cover locations. Verify actual R2 covers before production.',
        'backup_sha256': hashlib.sha256(Path(backup).read_bytes()).hexdigest(),
    }
    path = folder / 'report.json'; path.write_text(json.dumps(report, indent=2)); path.chmod(0o600)
    source.close(); transformed.close()
    return report


def template(backup):
    db = load_backup(backup)
    users = list(db.execute('SELECT id, username FROM users ORDER BY username'))
    db.close()
    return {'accounts': [{'username': row['username'], 'source_ids': [str(row['id'])], 'primary_id': str(row['id'])} for row in users]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--template', help='Create a PRIVATE account-group manifest to review locally.')
    parser.add_argument('--accounts', help='Reviewed private manifest. It contains IDs/usernames only, no passwords.')
    parser.add_argument('--out', help='New private directory outside GitHub for SQL, local database and reports.')
    args = parser.parse_args()
    if args.template:
        path = Path(args.template)
        if path.exists(): raise MigrationError('The private manifest already exists; refusing to overwrite it.')
        path.write_text(json.dumps(template(args.backup), ensure_ascii=False, indent=2)); path.chmod(0o600)
        print('Private account manifest created locally. Review source_ids and primary_id before planning.')
    elif args.accounts and args.out:
        report = build_plan(args.backup, json.loads(Path(args.accounts).read_text()), args.out)
        print(json.dumps({'accounts_before': report['accounts_before'], 'accounts_after': report['accounts_after'],
            'all_credentials_rotated': True, 'all_old_sessions_revoked': True, 'rollback_keeps_fresh_credentials': True,
        'all_ids_are_numeric_text': report['all_ids_are_numeric_text'], 'apply_and_rollback_verified_locally': True}))
        print('Fresh passwords and recovery codes are in credentials.local.json. Applying the migration invalidates ALL old credentials and sessions.')
        print('No Cloudflare connection or production change occurred. Private files remain on this computer.')
    else: parser.error('Use --template, or both --accounts and --out.')


if __name__ == '__main__':
    try: main()
    except (MigrationError, sqlite3.Error) as error:
        print('Stopped safely: ' + str(error))
        raise SystemExit(1)
