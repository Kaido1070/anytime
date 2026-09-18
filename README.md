# Wany

Wany is a private, mobile-first Arabic manga/manhwa reading web app. The current project is no longer a local mock-only prototype: it uses React on the frontend, Cloudflare Pages Functions for the API, and Cloudflare D1 for persistent user data.

The application is designed around reading first: source discovery, work details, chapter reading, per-user libraries and reading progress, personal lists, profiles, friends/activity, avatar selection, and administration.

## Current stack

- React 19 + TypeScript
- React Router 7
- Vite 6
- Plain CSS with a mobile-first dark UI
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- PWA/service worker support
- pnpm
- Node.js 22.18+ (Node 24 recommended)

## Run locally

```sh
pnpm install
pnpm dev
```

## Deployment

Production:

```text
https://anytimee.pages.dev/
```

Local development:

```text
http://localhost:5173
```

Validation commands:

```sh
pnpm test
pnpm build
pnpm preview
```

`pnpm build` runs the strict TypeScript build, creates the Vite production bundle, and generates the versioned service-worker precache.

There is currently no separate lint script in `package.json`.

## Application routes

Authenticated user routes currently include:

- `/profile` — account/profile overview.
- `/discover` — source discovery and search.
- `/fyp` — personalized/discovery feed.
- `/new` — new chapters.
- `/source/:key` — source work details.
- `/read-source/:key/:chapter` — full-width source reader.
- `/favorites` — favorites.
- `/lists` and `/lists/:id` — personal lists.
- `/friends` and `/friends/:id` — friends and profiles.
- `/admin` and `/admin/users/:id` — admin area for admin accounts.

Authentication is mandatory; unauthenticated users are shown the login screen.

## User data and reading system

User state is persisted server-side in D1. The reading model separates:

- the last chapter the user opened/read;
- the highest chapter the user has reached;
- per-chapter progress;
- completed chapters;
- independent reading-history events.

This distinction is intentional. If a user reaches chapter 150 and later rereads chapter 80, the reread is recorded and the last-read state may change, but the highest-reached chapter does not regress.

The user library supports work statuses and timestamps and drives the continue-reading experience. Reading progress is synchronized through authenticated API calls rather than being browser-only state.

## Personal lists

Personal lists are stored separately from Favorites.

A work can belong to multiple personal lists at the same time. List membership uses a many-to-many relation, and item ordering is persisted. Reordering is implemented without an external drag-and-drop dependency and supports pointer/touch interaction plus keyboard movement.

Favorites remain their own authoritative data set and are not duplicated into personal-list rows.

## Profiles, social features, and avatars

The repository contains the later user-system phases as well:

- modular/profile-section persistence;
- profile visibility support;
- friend requests and friendships;
- activity data;
- avatar-library data;
- account settings;
- admin/user-management support.

The UI remains reading-oriented rather than becoming a general-purpose social feed.

## Source content

The current application includes source-backed discovery, source work pages, new chapters, and a dedicated source reader. Source chapter images are treated as the primary reading asset; changes to the reader should preserve image quality and avoid unnecessary transformations or compression.

Source-related API handlers live under `functions/api/source/`, while the frontend source pages live primarily in:

- `src/pages/Discover.tsx`
- `src/pages/Fyp.tsx`
- `src/pages/NewChapters.tsx`
- `src/pages/SourceMangaDetails.tsx`
- `src/pages/SourceReader.tsx`

## Repository structure

```text
.
├── functions/              Cloudflare Pages Functions and API
│   └── api/
├── migrations/             D1 schema migrations
├── public/                 Static/PWA assets
├── scripts/                Build helpers, including SW generation
├── src/
│   ├── components/         Shared UI
│   ├── data/               Frontend data/helpers
│   ├── hooks/              Shared React state/hooks
│   ├── layouts/            User/admin layouts
│   ├── pages/              Route pages
│   ├── services/           API/data services
│   ├── types/              TypeScript contracts
│   ├── App.tsx             Routing and auth/admin gates
│   └── main.tsx            React entry + service-worker registration
├── tests/                  Native Node tests
├── PHASE2.md               Phase 2 implementation notes
├── PHASE3.md               Personal-list implementation notes
├── QA.md                   Verification notes
└── package.json
```

## D1 migrations

The repository currently contains migrations through `0011_d1_runtime_optimization.sql`.

Major schema milestones include:

1. Phase 2 server-side user/session data.
2. User library and reading history.
3. Personal lists.
4. User profile sections.
5. Profile visibility.
6. Friend requests.
7. Activity.
8. Avatar library.
9. Admin support.
10. Phase 10.5 additions.
11. D1 runtime optimization.

The application expects a Cloudflare D1 binding named exactly `DB`.

## Authentication and security

The server-side authentication implementation uses secure session cookies and D1-backed sessions. Session tokens are stored as hashes rather than plaintext tokens, and user passwords are stored as PBKDF2-SHA256 hashes with per-user salts.

API responses containing private application state should remain non-cacheable. The service worker must not cache `/api/*`.

Authorization rules belong in the backend. Frontend visibility alone must never be treated as access control, especially for private profile data and administrative capabilities.

## PWA

Production builds register `/sw.js` and use versioned local-asset precaching. The service worker is updated with `updateViaCache: "none"`, and the app reloads when an already-controlled page receives a new worker controller.

PWA/offline behavior should still be verified on the actual target browsers/devices before being treated as guaranteed offline support.

## UI principles

Wany is mobile-first and uses its existing dark visual language. When extending the application:

- preserve the current design system and responsive behavior;
- prioritize phone layouts;
- keep reader controls unobtrusive;
- preserve source cover and chapter-image quality;
- avoid breaking existing reading/navigation behavior;
- reuse existing API, authentication, and schema conventions instead of creating parallel systems.

## Development rules

Before implementing a feature:

1. Inspect the existing route/component/service and relevant D1 schema.
2. Reuse existing functionality instead of creating duplicate tables or state.
3. Keep authorization checks server-side.
4. Preserve image quality.
5. Validate both mobile and desktop behavior.
6. Run `pnpm test` and `pnpm build` after code changes when applicable.
7. Keep migrations auditable and avoid destructive changes to existing user reading data.

## Additional documentation

- `PHASE2.md` documents the move to Pages Functions + D1 and the reading/library system.
- `PHASE3.md` documents personal lists and ordering.
- `QA.md` contains earlier browser/build verification notes.

These files contain historical phase-specific details. This README is the high-level description of the repository's current architecture and feature set.
