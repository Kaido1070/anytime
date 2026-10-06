#!/usr/bin/env python3
"""Generate an additive source migration from a local SQLite backup, never D1.
The input is opened read-only; output contains schema statements, no user rows.
Apply the output once outside requests, before deploying to an older database.
"""
import argparse
import os
from pathlib import Path
import sqlite3


def prepare(backup):
    db = sqlite3.connect(Path(backup).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        alters = []
        for table, column, definition, required in [
            ('source_items', 'first_seen_at', 'INTEGER',
             {'source_key', 'source', 'source_id', 'slug', 'type', 'url', 'title',
              'cover_url', 'description', 'status', 'genres_json', 'updated_at'}),
            ('source_chapter_seen', 'is_baseline', 'INTEGER NOT NULL DEFAULT 0',
             {'source_key', 'chapter_identity', 'chapter_number', 'published_at', 'first_seen_at'}),
            ('source_sync_state', None, None, {'source', 'last_started_at'}),
        ]:
            columns = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
            if columns and not required.issubset(columns):
                raise ValueError(f'Unsupported schema for {table}; inspect before migrating')
            if columns and column and column not in columns:
                alters.append(f'ALTER TABLE {table} ADD COLUMN {column} {definition};')
        migration = (Path(__file__).resolve().parent.parent /
                     'migrations/0016_source_schema.sql').read_text()
        return 'PRAGMA defer_foreign_keys = ON;\n' + '\n'.join(alters) + '\n' + migration
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', help='Private local SQLite backup, not SQL text')
    parser.add_argument('output', help='New migration SQL file; refuses overwrite')
    args = parser.parse_args()
    sql = prepare(args.backup)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(sql)
    print('Source migration prepared; local backup unchanged. No remote database accessed.')
