# Account security audit — 2026-10-06

## Scope and evidence

Reviewed the account API, dedicated login/admin/password/recovery handlers, cookie/session behavior, role authorization, owned-data access, offline identity migration and a privately provided production D1 SQL export. Tests ran offline on SQLite with a D1-shaped transactional adapter. No production database, R2 object, Cloudflare setting or live deployment was modified. Private exports, hashes, mappings and generated credentials are not committed.

The export uses schema v19 and contains four distinct accounts. H has internal ID `has`; Y has internal ID `yas`; those are separate login and internal-identity fields, not duplicate account rows. There are no duplicate normalized login names, FK violations or orphan references in the discovered user-reference fields. The export contains 21 library rows, 3,552 progress rows, 3,738 history rows and 54 snapshots. R2 content cannot be verified from D1 metadata.

A stored password verifier and the three stored recovery verifiers matched historical credential material in the previous code snapshot. Removing literals from current source does not revoke those live credentials or remove Git history. The reviewed transition therefore rotates every password/recovery code once and revokes all old sessions. Ongoing password changes remain optional, with a six-character minimum; no mandatory-change login flow is introduced.

## Fixed behaviors

| Finding | Implementation and verification |
| --- | --- |
| Request-time identity/schema/credential repair | Removed account bootstrap and admin provisioning from request paths. Schema checks are read-only and missing support fails closed. |
| Fixed account IDs/credential material | Random immutable 32-digit TEXT IDs are stored in D1; login names are independent and admin is authorized by role. Runtime verifies only the primary stored credential; retired alternate hashes cannot authenticate. Historical real credential seeds and the fixed recovery bridge are removed. |
| Session issuance races password reset or role changes | Login and admin-login condition the session INSERT on the credential hash and role just verified. Tests interleave credential changes before issuance and confirm no cookie/session is created. |
| Password change races session revocation | Credential replacement checks both the expected hash and the still-valid authorizing session inside the atomic batch. Tests revoke that session between reads and writes and confirm the password remains unchanged. |
| Session persistence after credential changes | Password change revokes other sessions, rotates the current token, and sets the new HttpOnly cookie. Recovery revokes every session. Logout-all is exposed in settings. |
| Unbounded guessing | D1 stores atomic, expiring attempt counters shared across isolates. General/admin login share one scope. Limits per 15 minutes: 8 IP/account, 24 account, 60 IP. Password verification for settings is similarly bounded. An exhausted IP cannot allocate new account keys. Tests cover parallel requests, distributed IPs, expiry and endpoint switching. |
| Missing Origin accepted on browser mutations | Exact same-origin required for POST/PUT/PATCH/DELETE across account routes and cleanup-demo; cross-site Fetch Metadata also rejected. Tests verify rejection before SQL access. |
| Unbounded credential request bodies | Streamed JSON is limited to 32 KiB even without Content-Length; wrong media types and invalid JSON are rejected. Dedicated and wildcard credential handlers share the reader. |
| Recovery codes reusable or unavailable after consumption | High-entropy code digest stored per account, consumed atomically once. Authenticated settings can issue a replacement after checking the current password and valid session; this invalidates previous verifiers. New code is shown once and is never saved to browser storage. |
| Optional security-question recovery | Settings requires the current password and a valid session to create/replace the question. D1 stores the question and a salted PBKDF2 answer hash only. Recovery shares attempt limits, conditionally replaces the expected password, and revokes all sessions. Tests cover wrong/normalized answers, replacement, account isolation and concurrent resets. |
| Inconsistent/weak password creation cost | Offline migration, password change and recovery use PBKDF2-SHA256 at 100,000 iterations; verification reads each stored cost. This conservative Workers cap requires deployed compatibility/CPU testing and is below ideal password-hashing guidance. |
| Credential details in exception logging | Changed credential-path logs to report error names rather than SQL/error parameters. |

The D1 binding batch transaction semantics used by the conditional mutations are documented at https://developers.cloudflare.com/d1/worker-api/d1-database/#batch. Workers' conservative PBKDF2 cap and proposed increase are tracked at https://github.com/cloudflare/workerd/issues/1346 and https://github.com/cloudflare/workerd/pull/7550. Local WebCrypto/SQLite tests do not establish production CPU limits.

## Validation

- The generated transition and guarded data rollback both passed against the private export. All original noncredential data rows matched after substituting the ID map, including nonaccount source/avatar tables. Credentials and sessions are intentionally replaced. No discovered FK violation remained.
- All four accounts logged in using generated credentials on a cloned migrated database. Both password-change handlers accepted six characters, rejected five, persisted the new hash, rejected the previous password, preserved the internal ID and revoked other sessions. Numeric admin login and one-use recovery succeeded.
- 39 dedicated Node account/security tests passed, including a wrapper that runs 11 Python migration tests. Before the admin-reset addition, the full repository suite had 235 tests: 226 passed and 9 remaining failures outside account authentication. Build and whitespace checks passed.
- A scan of current functions/src/scripts/migrations/docs/tests found none of the actual exported password or recovery hash literals. Private migration output is outside the repository.

## Remaining deployment and coverage limits

The branch remains draft and production is unchanged. Do not deploy the account code onto the current v19 database alone. Prepare a fresh private export during a write pause, generate the guarded transition, save the private replacement credentials, apply it atomically in restored isolated D1 staging, and test the deployed Worker before coordinating production migration/code deployment. Existing R2 keys are retained and read through owner-scoped aliases. R2 is a regenerable cover cache: no full R2 backup or object transfer is required for the account migration. Profile refresh refetches and uploads missing covers when the source is reachable. Live R2 behavior was not exercised here; unavailable upstream sources can leave a cover temporarily missing without affecting account or reading data.

D1 attempt counters protect credential checks, not volumetric edge/database-cost attacks. WAF/edge protection needs environment validation. Per-account budgets can temporarily deny a legitimate login under targeted abuse. Trusted IP handling assumes Cloudflare's CF-Connecting-IP header.

Admin password reset is implemented; public/invite account creation and a separate recovery-approval workflow are not implemented. Source APIs retain their unrelated request-time source schema bootstrap. A comprehensive reader/source/image security audit, deployment secret inventory, historical Git cleanup and proof of production exploit activity are outside this account audit. Restoring an old export or deploying the old recovery handler can revive exposed credentials; use the guarded rollback that retains fresh passwords instead.

Security-question answers are reusable recovery secrets, not MFA. A public question challenge can disclose that an account has configured recovery. Guessable or publicly known answers weaken account security even with hashing and attempt limits; prefer a random recovery code or an unpredictable secret answer. OWASP discourages questions as the sole reset factor: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html. The requested optional question flow is supported without requiring a second factor.

Admin user details now expose the saved question only and can reset ordinary user passwords after verifying the administrator’s current password. The atomic mutation rechecks admin role, credential and live session plus the target credential, revokes target sessions/legacy verifiers/recovery codes, and records actor, target and time in admin_credential_events. Passwords and answer hashes are never returned or logged. The question remains configured. Tests verify persistent replacement, role/Origin/minimum-length rejection and session-revocation races. Admin authority is enforced by the application, not by exposing a Cloudflare token or arbitrary SQL endpoint.

Additional admin review tests reject races that revoke admin role, change the admin credential or change the target credential; reject anonymous/missing-Origin/admin-target requests; confirm no secret fields in responses; enforce shared guessing limits across target accounts; and prove the complete reset rolls back if its audit insert fails. All 39 dedicated Node tests passed. No new bypass was reproduced in these offline tests; production D1/Workers validation remains outstanding.
