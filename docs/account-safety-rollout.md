# Private numeric account migration

## Result and failure mechanism

Accounts use immutable random 32-digit IDs stored as TEXT in D1. Usernames remain login names (for example `m`, `y`, `h`, `admin`); admin permissions come from role. No runtime mapping binds those names to IDs. Never convert IDs to JavaScript Number or SQLite INTEGER.

The old request bootstrap could throw on H/has or Y/yas conflicts before any API handler, and rewrote credentials. Admin login also provisioned credentials and removed social data. This implementation removes those side effects and validates schema version >=20 without running DDL. Production causality cannot be established without its logs; no live database was accessed.

## Keep the export private

The scripts have no Cloudflare connection. All exports, generated SQL, migrated databases and rollback files contain private credential material and must stay outside GitHub. You do not need to send them to anyone.

From the repository, generate a private manifest using a complete D1 SQL export:

```sh
python scripts/migrate-numeric-user-ids.py --backup /private/wany-backup.sql --template /private/accounts.local.json
```

Review that manifest locally. Each account has `username`, `source_ids`, and `primary_id`. Put only rows belonging to the same actual person in one group. Set the desired login names to `h`, `y`, `m`, `admin`. Include every source row exactly once. The explicitly chosen primary row supplies password and profile settings when source rows disagree; the tool does not guess ownership from names. Keep separate people in separate groups.

```sh
python scripts/migrate-numeric-user-ids.py --backup /private/wany-backup.sql --accounts /private/accounts.local.json --out /private/wany-migration
```

The output directory must be new. The tool verifies apply and rollback against the export locally, then writes `apply.sql`, `rollback.sql`, `mapping.local.json`, `migrated.sqlite`, and `report.json`. It stops on incomplete manifests, role conflicts, foreign-key violations, unsupported conflicting records or incompatible schemas. It requires the complete runtime v19 schema, including snapshots; an older database needs its own reviewed preparation first.

## What the migration preserves

The migration discovers user foreign keys and dependent tables, also updating known pair-ID fields without foreign keys. Overlapping library/progress rows preserve highest progress and latest reading state; history, lists and their items remain attached. Social links are reconciled and self-links removed. Conflicting profile settings use the reviewed primary account.

Passwords and historical compatible verifiers move into per-account D1 rows. Successful explicit password changes retire alternate verifiers and revoke other sessions. Recovery checks D1 rows rather than fixed account names, consumes the code once, and revokes sessions. Historical compatibility material exists only in the offline migration bridge, not runtime account mappings. This is a transition mechanism, not a completed new recovery issuance/admin-review UI or rate-limiting system.

R2 objects are not moved or deleted. Owner-scoped aliases and preferred snapshot locations in D1 keep old cover paths readable. Retain and verify the R2 backup. Sessions attached to changed IDs are invalidated, so those users sign in again.

## Production gate

1. Keep fresh D1 and R2 backups and test their restoration. Plan from the final D1 export taken after pausing writes.
2. Apply generated SQL to an isolated restored staging database first. Use an isolated Wrangler migrations directory containing only the generated `apply.sql`; do not replay the repository's old migrations indiscriminately on a runtime-created schema. The generated file already includes additive support schema and advances to v20 only with the identity conversion.
3. Use a D1 migration mechanism that provides one transaction and rollback on failure. Generated files deliberately omit BEGIN/COMMIT. Validate the entire file on actual D1, including statement limits and deferred foreign keys.
4. Test every actual account's login, admin role, library, progress, lists, social links, covers and password change with the updated code. Node/SQLite tests do not prove Workers PBKDF2 compatibility. Unsupported legacy cost returns 503 rather than silently weakening stored parameters; provision a verified compatible credential before deployment if necessary. New password changes retain the existing 25,000-iteration setting pending a separate runtime-tested policy upgrade.
5. Compare the private report and row-level results. Only then coordinate the production migration and compatible code deployment during a write pause. Deploying the code on v19 alone returns a migration-required 503; do not deploy prematurely.

Apply and rollback files include exact schema/data guards. New writes or schema changes make the plan fail rather than overwrite newer data. Generate a new plan from a fresh export when guards reject it. Test the D1 execution path before relying on this protection in production.

## Rollback

Keep the mapping and original backup private. Verify rollback on staging before production. If no subsequent writes occurred, the guarded rollback restores original account rows and data; additive support tables remain empty. If writes occurred, rollback intentionally stops: reconcile the new data first instead of restoring an old export blindly. Avoid redeploying the former automatic repair logic without diagnosing its conflict.

The branch is a draft implementation. No production D1/R2 conversion or deployment has occurred. Forced password upgrade, issuing replacement recovery codes, admin-assisted recovery and durable rate limiting are subsequent work.
