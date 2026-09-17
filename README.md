# Anytime

A mobile-first, private reading-room prototype built with React, TypeScript, Vite, and plain CSS. All manga metadata, covers, chapter panels, and friend activity are local mock content. No external content sources or backend are connected.

## Run locally

Use Node.js 22.18+ (Node 24 recommended) and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Sign in as **Mahdi**, **Kaido**, or **Ahmed**, with password **anytime**. Usernames are case-insensitive. Passwords are neither stored nor sent anywhere.

```sh
pnpm test     # Native Node service tests; no test-framework dependency
pnpm build   # Strict TypeScript check, Vite bundle, PWA asset precache
pnpm preview # Production app on http://localhost:4173
```

## Files and architecture

- `src/App.tsx`, `src/main.tsx`: routing, session gate, React entry, production service-worker registration.
- `src/pages/`: Login, Home, MangaDetails, Reader, Favorites, Friends / FriendProfile, Profile.
- `src/layouts/AppLayout.tsx`: app header and mobile bottom navigation; the reader has its own full-width layout.
- `src/components/UI.tsx`: shared cover cards, progress bar, navigation icons, section titles.
- `src/types/index.ts`: user, manga, friend, and versioned library contracts.
- `src/data/mock.ts`: local catalog, sample chapters, three mock accounts, and friend activity.
- `src/services/userData.ts`: asynchronous `UserDataService` contract and localStorage implementation. UI components never access storage directly.
- `src/hooks/useLibrary.tsx`: shared session/library state, service calls, and persistence error feedback.
- `src/styles.css`: mobile-first dark appearance, safe-area insets, touch-sized controls, reduced-motion support, and desktop layout.
- `public/covers/`, `public/panels/`, `public/icons/`: original local SVG placeholders and temporary PNG app icons.
- `public/manifest.webmanifest`, `public/sw.js`, `scripts/build-sw.mjs`: standalone PWA and content-versioned local-asset precache.
- `public/_redirects`: SPA route fallback for Cloudflare Pages.
- `tests/userData.test.mjs`: credentials, favorites, deduplication, user isolation, progress, completion, sign-out, and corrupted-storage recovery.
- Vite / TypeScript configuration, package manifest, and pnpm lockfile.

## Persistence

`anytime:session` stores the mock user ID. `anytime:v1:user:<id>` stores that user's favorites, per-chapter percentage and timestamp, completed chapters, and last opened manga/chapter. Sign-out keeps each user's library. Progress writes are debounced during scrolling and flushed when leaving a chapter or hiding the page. Chapters are completed at 98%; rereading does not erase completion. Restoration uses the scrollable document percentage and fixed image aspect ratios to avoid layout shifts while panels load.

## Cloudflare and Phase 2

The build emits a static `dist/` directory suitable for [Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/): build command `pnpm build`, output directory `dist`. Nothing has been deployed.

Phase 2 can implement the same asynchronous service contract using authenticated Worker API calls and D1 storage, retaining the route components and library hook. Add server-side authorization and session handling before using real private content. The mock sign-in is only a UI simulation and does not protect static assets. Catalog data and friend activity are separate mock fixtures ready for a later data provider.

## PWA and known limitations

- Production builds precache the app and local placeholders; development mode does not register a service worker. Updates activate after old app tabs close.
- On an iPhone, use HTTPS hosting and Safari's Share → Add to Home Screen. A LAN HTTP development URL can preview layout but cannot provide a full secure-context PWA experience.
- Device-sized Chromium testing is recorded in `QA.md`; physical iPhone Safari installation and WebKit behavior still need device verification.
- Offline reload did not succeed in the in-app browser during verification. The PWA scaffolding is included, but offline support must be verified before relying on it.
- Data stays in this browser and is not synchronized or backed up. Clearing site storage removes it. Concurrent edits from multiple tabs are not coordinated in Phase 1.
- All users start with the same small sample library; friend profiles are fixed mock examples. The same six local panels are reused for each sample chapter.
- Icons and artwork are placeholders. No scraping, external manga images, real authentication, D1, messaging, analytics, ads, or payments are implemented.
