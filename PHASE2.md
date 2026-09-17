# Anytime — Phase 2

Phase 2 moves account state from browser-only storage to Cloudflare Pages Functions + D1.

## Included

- Real server-side sessions using an HttpOnly, Secure, SameSite=Lax cookie.
- Session tokens are stored in D1 only as SHA-256 hashes.
- Passwords are stored only as PBKDF2-SHA256 hashes with per-user salts and 210,000 iterations.
- Favorites sync across devices.
- Reading progress, completed chapters, and last-opened chapter sync across devices.
- Friends and their favorites/current reading state come from D1.
- Existing Phase 1 local data is imported once after the first successful Phase 2 login.
- Profile password changes invalidate the user's other active sessions.
- API responses are `Cache-Control: no-store`, and the PWA service worker never caches `/api/*`.
- The existing automatic PWA cache versioning remains enabled for every build.

## Cloudflare one-time setup

The code needs a D1 binding named exactly `DB`.

1. In Cloudflare, create a D1 database named `anytime-db`.
2. Open the `anytimee` Pages project.
3. Go to **Settings → Bindings → Add → D1 database binding**.
4. Set **Variable name** to `DB` and select `anytime-db`.
5. Add the binding to **Production** (and Preview too if desired).
6. Redeploy the latest `main` deployment.

No manual SQL migration is required for first use: the API creates the Phase 2 schema and seed rows automatically when it first sees a bound empty D1 database. The same schema is also kept in `migrations/0001_phase2.sql` for audit/recovery.

## Initial accounts

The private accounts remain `mahdi`, `kaido`, and `ahmed`. Their original Phase 1 password remains valid initially, but it is not stored as plaintext in the database or migration. Change it from **Profile → تغيير كلمة المرور** after the first login.

## API routes

- `GET /api/health`
- `GET /api/session`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/data`
- `POST /api/favorites`
- `DELETE /api/favorites/:mangaId`
- `PUT /api/progress`
- `GET /api/friends`
- `POST /api/friends`
- `DELETE /api/friends/:userId`
- `POST /api/import`
- `POST /api/change-password`
