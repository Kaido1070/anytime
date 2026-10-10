# WANY security review — 2026-10-10

## Scope and evidence
Static source review of the current GitHub main branch: account/session/registration/admin APIs, source image proxy and outbound transport, D1 badges, public assets, GitHub workflows, PWA cache and existing security tests. The CI suite tests mocked D1 behavior, not the live Cloudflare D1, WAF, R2, browser or deployment settings. This is not a penetration test or proof that no vulnerabilities exist. No private D1 records were fetched or committed.

## Verified controls
- D1 badge grants are selected by user ID from `user_badges` on the server; the client cannot write badge types. F12 can still draw a local fake badge.
- SQL uses bound parameters for account/session writes; D1 has ownership checks in the reviewed routes.
- Authentication sessions use random tokens, hashed server-side, with Secure/HttpOnly/SameSite=Lax cookies.
- Mutations require an exact same-origin Origin; credential bodies have 32 KiB streamed limits; D1 rate limits and role checks exist.
- Image routes reject script-capable SVG and enforce raster MIME; outbound source transport checks each redirect against an exact HTTPS host allowlist and has per-request budgets.
- The PWA does not persist authenticated API JSON into CacheStorage.
- Build rejects database dumps in public/dist; CI now rejects tracked private database export names and selected embedded secrets.

## Findings, mitigations and follow-up
| Priority | Finding / risk | Current action | Remaining verification or correction |
| --- | --- | --- | --- |
| High | Raw errors and internal user/work identifiers appeared in five production log calls; a thrown database error may contain sensitive context. | Redacted these log calls to error *names* only. | Search all other Workers and historical Cloudflare logs; set restricted log retention and access. |
| High | No guarantee that old Git commits, workflow artifacts, Pages deployments or archived copies are free of D1 dumps/secrets. Current-tree scanning alone is insufficient. | Added tracked-file and client-source secret guard to CI. | Scan complete Git history and Actions artifacts using a dedicated secret scanner; rotate any discovered credentials; purge retained copies as supported. |
| High | Badge enrichment walks successful JSON responses and adds a D1 query. It is intentionally non-authoritative for authentication and fails without badge on missing table, but a broad response traversal increases attack surface and cost. | Uses bound ID values and strict badge types; no user-supplied badge grants. | Refactor to explicit, typed identity fields at known API routes; enforce bounded response size and add authenticated/public response tests. |
| High | Live Cloudflare Pages bindings, preview/production D1 isolation and admin role grants cannot be verified from GitHub. | No changes to D1. | Verify production DB ID and R2 binding, ensure previews never write production data, verify least-privilege Cloudflare/GitHub tokens and protect main. |
| Medium | No globally audited CSP, HSTS, Referrer-Policy, frame-ancestors and Permissions-Policy in the reviewed static asset configuration. | Image responses have restrictive CSP and nosniff. | Inventory all external images/scripts, then deploy CSP in report-only mode, validate and enforce compatible headers on Pages and API. |
| Medium | Some login and security-question flows use PBKDF2 100k iterations, documented below ideal modern memory-hard hashing guidance. | Per-user salt and iteration metadata; rate limits. | Benchmark supported Workers crypto and plan a gradual Argon2id/scrypt migration if runtime permits, or stronger PBKDF2 settings. |
| Medium | Rate limits rely on CF-Connecting-IP and D1 counters; abuse resistance depends on Cloudflare edge configuration and monitoring. | Atomic D1 counters and fixed windows. | Verify CF-managed IP header trust and enable WAF/bot/rate-limit rules, alert on spikes, test concurrent abuse safely. |
| Medium | Source proxy fetches permitted external hosts; allowlist and redirect checks mitigate SSRF, but DNS rebinding/edge egress policy is not independently proven. | Exact host allowlist, manual redirects, timeouts, response limits. | Test host resolution/egress restrictions, redirects, oversized/chunked bodies and malformed MIME against staging. |
| Medium | Public image bytes are validated primarily by declared MIME type, not fully decoded content. | SVG excluded, nosniff, CSP sandbox for image routes. | Add magic-byte checks and image decoding/re-encoding for untrusted cover uploads; inspect legacy R2 content. |
| Medium | Third-party CI actions and dependencies are version-tagged, not pinned to immutable digests; image workflow can push to main with contents:write. | Validate workflow is read-only; image job scope is limited to assets. | Pin actions by SHA, use dependency review, protect main and restrict workflow write permissions; review image source trust. |
| Medium | Public/private profile behavior and social authorization require negative tests against real staging D1 data and identity migrations. | Existing mocked API and migration tests. | Verify IDOR, mass assignment, cross-account friend/library/list/activity access, and role transitions in staging. |
| Low | Username and account IDs in public profile API may be visible by design. They are identifiers, not authentication secrets. | No private database export needed in frontend. | Review which fields are public and suppress unnecessary identity metadata; never log or display password hashes, recovery verifiers or session tokens. |

## Required validation before calling the release security-reviewed
1. Latest GitHub Validate workflow succeeds after the changes above.
2. Confirm production deployment SHA matches tested main; check login, logout, password recovery, admin authorization, friends and badge rendering on staging/live with test accounts.
3. Verify D1 data stays in D1, Git history/Actions artifacts contain no secrets, and Pages previews have isolated bindings.
4. Conduct authenticated/unauthenticated API authorization matrix, CSRF/CORS, XSS/CSP, SSRF, caching, race-condition, and rate-limit tests.
5. Run dependency, code, and secret scanners and triage results; record residual risks and incident/rollback plan.

This report documents identified controls and risks, not an assertion that every possible vulnerability has been eliminated.
