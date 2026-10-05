# Account safety repair: first deployment gate

The October 4–5 conversation reported local identity/auth changes, but no corresponding branch or pull request was present when work resumed. Main was still `ceafb7f6053d730509e103d951c6724f8ad3bb40`. This patch is a fresh, reviewable first stage; it does not claim to recover those unsaved files.

## Confirmed failure mechanism

The former `ensureCanonicalAccountNames` ran before every API route on a new isolate. It threw if H/Y belonged to a row other than has/yas, and otherwise rewrote their password salt/hash. A conflict could prevent health, session, library, and login requests from reaching their handlers. Earlier runtime identity migrations also disagreed with SQL 0014. Production causality still requires its D1 rows and error logs.

## Changes

- Runtime validates schema version 19 or newer, without bootstrap, identity repair, credential writes, or DDL. Older databases receive `SCHEMA_MIGRATION_REQUIRED` (503).
- Admin schema checks are read-only. Admin login verifies an existing user with role=admin and never provisions, resets credentials, or purges social data. A compatibility login alias for the existing reserved admin row remains until that account is reviewed.
- Login and both password-change implementations use the same password helper. New password changes retain the existing dedicated endpoint's 25,000-iteration setting; stored credential parameters are still honored. The three existing default-password compatibility hashes are used for verification only, with no rewriting. This is a temporary bridge, not the final password policy.
- Login username lookup is case insensitive, preserving uppercase H/Y names.
- No account IDs, relationships, live passwords, R2 objects, or frontend behavior are migrated by this PR.

## Before merging into the production branch

1. Obtain a fresh D1 export and confirm R2 backup coverage. Exports contain private credential material: keep them out of GitHub.
2. Run `python scripts/inspect-account-backup.py /path/to/wany-backup.sql`. It reconstructs only an in-memory SQLite database, reports identities/reference counts, and never prints password hashes, salts, session tokens, or recovery codes. It does not connect to Cloudflare.
3. Confirm schema version >=19 and required tables/columns. If older, prepare explicit deployment migrations against that export first; do not merely change the version marker. SQL 0014 is not a safe general merge for existing duplicate accounts or runtime snapshot tables.
4. Confirm the stored admin credential works without ADMIN_INITIAL_PASSWORD provisioning. Check all H/Y/M credentials on a restored staging copy.
5. Check PBKDF2 parameters on the actual Workers runtime: legacy 210,000-iteration credentials outside the existing compatibility map may exceed its crypto limit. Node tests do not establish deployed-runtime compatibility. Never lower the iterations field without rehashing the actual password.
6. Only deploy after those gates. No production schema or credential changes are included here.

## Following stage: merge H/Y data

The canonical IDs can be `h` and `y` if that is the chosen design; IDs do not need to match usernames. First establish which rows belong to each real account from the export. Then generate a reviewed merge that reconciles overlapping library/progress/history/state rows, preserves lists and profile settings, updates both sides of social relationships and pair fields, carries recovery/audit/snapshot rows, and preserves access to covers under old R2 keys. Compare row-level data before and after and test rollback on the staging copy. Do not edit or delete a users row directly in D1 to simulate this merge.

Forced password change, per-account recovery codes, rate limiting, random-ID migration, and admin-assisted recovery remain the next stage after inspecting real account data. They are not implemented in this first safety patch.

## Rollback

Keep the current deployment available. This PR makes no production data migration, so a code rollback does not require restoring D1. Restoring the old deployment also restores its dangerous automatic repair logic; use it only after diagnosing the specific failure, with the backup retained. Never overwrite new reading progress with an old export as an automatic rollback.
