# Phase 1 verification

## Automated

- `pnpm test`: two native Node tests passed, covering valid/invalid login, favorites add/remove/deduplication, account isolation, friend exclusion, per-chapter progress, last opened chapter, completion, sign-out, and corrupt storage recovery.
- `pnpm build`: strict TypeScript compilation and production bundling passed. Build script generates a versioned service worker with every local app asset in its precache.

## Browser checks

Performed against the running app in Chromium, using a 390 × 844 mobile viewport:

- Mock sign-in, invalid-password feedback, sign-out, and switching from Has to Yas.
- Home, Favorites, Friends, friend profile, Profile, manga details, and chapter reader navigation.
- Favorite removal persisted after a page reload.
- A friend's Eleceed favorite copied into Has's library; the copy button became disabled and the manga appeared in Favorites.
- Yas retained a separate sample library after switching accounts.
- Seeded chapter 143 restored to 62%. Scrolled to approximately 94.63%; leaving/reopening and a full reload both restored the measured 94.63% position.
- Reaching 100% marked chapter 143 completed. Next chapter 144 opened at 0%; the details page reflected both states.
- Mobile login overlap was found and corrected.
- Desktop Home was visually checked at 1280 × 900; reader layout was checked at 375 × 812 without horizontal overflow.
- Previous-chapter navigation passed in the production build. A fresh production session reported no console warnings or errors.
- A development hot-reload root-recreation error was corrected by separating the App component and preserving the React root across module replacement.
- Stopping the preview server and reloading produced a blank page in the in-app browser. Offline operation is **not verified**; the cause was not established. Online preview was restored. The manifest, icons, and generated precache are present, but offline behavior requires follow-up in a standard browser and iPhone Safari.

Physical iPhone / Safari and actual Add to Home Screen installation remain unverified. These checks do not imply backend security or cross-device synchronization.
