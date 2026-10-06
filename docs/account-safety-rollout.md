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

Review that manifest locally. Each account has `username`, `source_ids`, and `primary_id`. Put only rows belonging to the same actual person in one group. Set the desired login names to `h`, `y`, `m`, `admin`. Include every source row exactly once. The explicitly chosen primary row supplies profile settings when source rows disagree; all credentials are freshly generated; the tool does not guess ownership from names. Keep separate people in separate groups.

```sh
python scripts/migrate-numeric-user-ids.py --backup /private/wany-backup.sql --accounts /private/accounts.local.json --out /private/wany-migration
```

The output directory must be new. The tool verifies apply and rollback against the export locally, then writes `apply.sql`, `rollback.sql`, `mapping.local.json`, `credentials.local.json`, `migrated.sqlite`, and `report.json`. It stops on incomplete manifests, role conflicts, foreign-key violations, unsupported conflicting records or incompatible schemas. It requires the complete runtime v19 schema, including snapshots; an older database needs its own reviewed preparation first.

## What the migration preserves

The migration discovers user foreign keys and dependent tables, also updating known pair-ID fields without foreign keys. Overlapping library/progress rows preserve highest progress and latest reading state; history, lists and their items remain attached. Social links are reconciled and self-links removed. Conflicting profile settings use the reviewed primary account.

Every account receives a fresh random 32-character password and a fresh random recovery code. All old passwords, alternative verifiers, recovery codes and sessions are invalidated by the generated migration. Fresh secrets are written only to `credentials.local.json` (mode 0600) on your computer, never printed or embedded in source. Save them securely before applying, and deliver each account's secrets only to its owner through a private channel. D1 and generated apply SQL contain only salted password hashes and recovery-code hashes. Recovery uses SHA-256 for the high-entropy random code, consumes it once and revokes sessions. Password changes now require at least 6 characters.

Historical credential seeds have been removed from migrations 0001/0013 and the offline compatibility bridge has been deleted. This does not erase earlier Git commits or rotate a live account until the migration is applied. Already-applied migrations are not replayed; new installations no longer seed real accounts. General account names remaining in historic identity migrations are identifiers, not passwords.

Authenticated settings can issue a replacement one-use recovery code after verifying the current password; only its SHA-256 digest is stored. The code appears once in the response/UI and replaces every previous code. D1 persists 15-minute attempt budgets shared across isolates and the general/admin login endpoints (8 per IP/account pair, 24 per account, 60 per IP). Successful attempts also count. Login, recovery and current-password verification use separate operation scopes; password change and code issuance share a scope. Admin-assisted recovery is not implemented.

R2 objects are not moved or deleted. Owner-scoped aliases and preferred snapshot locations in D1 keep old cover paths readable. Profile content refresh checks for missing covers and refetches/uploads them in the background when the source is available; failure must not block reading. R2 is a disposable cover cache, not account/reading data. A full R2 backup or copying objects is optional, not an account-rollout prerequisite. All sessions are invalidated, even for accounts whose ID was already numeric, so those users sign in again.

## Production gate

1. Keep a fresh D1 backup and test its restoration. Plan from the final D1 export taken after pausing writes.
2. Apply generated SQL to an isolated restored staging database first. Use an isolated Wrangler migrations directory containing only the generated `apply.sql`; do not replay the repository's old migrations indiscriminately on a runtime-created schema. The generated file already includes additive support schema and advances to v20 only with the identity conversion.
3. Use a D1 migration mechanism that provides one transaction and rollback on failure. Generated files deliberately omit BEGIN/COMMIT. Validate the entire file on actual D1, including statement limits and deferred foreign keys.
4. Test every actual account's login, admin role, library, progress, lists, social links and password change with the updated code. Node/SQLite tests do not prove Workers PBKDF2 compatibility. New credentials and password changes use 100,000 PBKDF2-SHA256 iterations, up from 25,000. This is constrained by the conservative Workers per-call cap; it is not a claim of ideal password hashing strength. Test deployed CPU cost and compatibility on the actual Pages/Workers plan before production.
5. Compare the private report and row-level results. Only then coordinate the production migration and compatible code deployment during a write pause. Deploying the code on v19 alone returns a migration-required 503; do not deploy prematurely.

Apply and rollback files include exact schema/data guards. New writes or schema changes make the plan fail rather than overwrite newer data. Generate a new plan from a fresh export when guards reject it. Test the D1 execution path before relying on this protection in production.

## Rollback

Keep the mapping, credentials and original backup private. Verify rollback on staging before production. If no subsequent writes occurred, the guarded rollback restores account IDs and owned data while KEEPING NEW PASSWORDS and revoked old sessions. Old password/recovery verifiers are never restored. The new recovery code stays attached only to the explicitly reviewed primary source account. Rolled-back duplicates share the newly generated account password; resolve ownership before reopening access. The version marker returns to its original value, so compatible access may require a reviewed schema plan. Support tables remain present.

If writes occurred, rollback intentionally stops: reconcile the new data first instead of restoring an old export blindly. Do not restore the original export or deploy the old fixed-code recovery endpoint as a security rollback; either can reintroduce exposed credentials.

The branch is a draft implementation. No production D1/R2 conversion or deployment has occurred. Initial private credential rotation is included. Replacement recovery-code issuance and durable rate limiting are implemented. Admin-assisted recovery remains future work.

## Request and session protections

Browser mutation requests require the exact same Origin, and reject cross-site Fetch Metadata. All JSON mutation readers cap the actual streamed body at 32 KiB, independently of Content-Length. Login issuance uses a conditional INSERT tied to the credential hash and role just verified, so a racing reset or role change cannot revive access. Password replacement atomically checks the current credential AND still-valid authorizing session, revokes every other session, rotates the current session token, and returns the new HttpOnly cookie. Logout-all is available in settings and revokes every session for the account. Logs report error names, never SQL parameters or credentials.

The D1 throttle table is added by the support migration. Missing support schema fails closed with a migration-required response; there is no request-time DDL. On an already migrated v20 installation, add the reviewed throttle table separately instead of rerunning the identity/password-rotation migration. IP budgets trust Cloudflare's CF-Connecting-IP, never arbitrary forwarded headers; deploying behind a different proxy requires a reviewed trusted client-IP strategy. Counters can temporarily block a legitimate account under targeted abuse; Cloudflare edge rate limits/WAF are still needed for volumetric attacks and database-cost control.

Private-export validation on 2026-10-06 found four distinct accounts on schema v19, no duplicate normalized names, and no FK or discovered orphan references. Applying and rolling back the generated transition was tested offline against that export. Every owned data row matched after mapping the IDs; credentials and sessions are intentionally replaced. Do not confuse local validation with production revocation. Actual R2 objects and deployed runtime were unavailable for this test.

## Optional security question

Settings lets each account save or replace a custom question after verifying its current password. The question and salted PBKDF2-SHA256 answer hash (100,000 iterations) live in D1; no answer is stored in source or browser storage. Answers normalize Unicode, case and whitespace consistently. Both password and answer have a six-character minimum. The forgot-password form can display the saved question, verify the answer, replace the password atomically and revoke all sessions. The question remains usable for future resets; changing it retires the previous answer. The one-use random code remains an alternative.

Choose an unpredictable answer, not known names or dates. Questions alone provide weaker recovery assurance than a random code; public question challenges can reveal configured accounts. Setup and recovery are optional and rate limited. The support schema includes user_security_questions. An already migrated v20 database needs an additive migration for missing support tables, rather than replaying the identity transition.
