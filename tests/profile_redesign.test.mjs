import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { availableChapterProgress } from "../src/services/profileProgress.ts";

test("profile available-chapter progress uses chapter position, not numeric division", () => {
  const chapters = [
    { number: 1, title: "1" },
    { number: 2, title: "2" },
    { number: 4, title: "4" },
    { number: 5.5, title: "5.5" },
  ];
  const progress = availableChapterProgress(chapters, 4);
  assert.ok(progress);
  assert.equal(progress.currentPosition, 3);
  assert.equal(progress.totalPositions, 4);
  assert.equal(progress.percent, 75);
  assert.equal(progress.latestChapter, 5.5);
});

test("profile progress omits a percentage when highest chapter cannot be ordered safely", () => {
  const chapters = [
    { number: 1, title: "Prologue" },
    { number: 2, title: "2" },
    { number: 4, title: "4" },
  ];
  assert.equal(availableChapterProgress(chapters, 3), null);
  assert.equal(availableChapterProgress([], 1), null);
  assert.equal(availableChapterProgress(chapters, null), null);
});

test("profile progress deduplicates repeated chapter numbers before calculating positions", () => {
  const chapters = [
    { number: 1, title: "1" },
    { number: 1, title: "1 mirror" },
    { number: 2, title: "2" },
    { number: 3, title: "3" },
  ];
  const progress = availableChapterProgress(chapters, 2);
  assert.ok(progress);
  assert.equal(progress.currentPosition, 2);
  assert.equal(progress.totalPositions, 3);
  assert.ok(Math.abs(progress.percent - 66.6666666667) < 0.0001);
});

test("account profile has fixed hierarchy and modular content groups", async () => {
  const account = await readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8");
  assert.match(account, /ProfileIdentityHeader/);
  assert.doesNotMatch(account, /ProfileSummaryStrip/);
  assert.match(account, /ProfileStatsSection/);
  assert.match(account, /id: "lists"/);
  assert.match(account, /id: "reading"/);
  assert.match(account, /id: "activity"/);
  assert.match(account, /sectionsForSave/);
  assert.doesNotMatch(account, /<Home embedded/);
  assert.doesNotMatch(account, /<Friends embedded/);
  assert.doesNotMatch(account, /<Lists embedded/);
});

test("friends hub owns friends, requests and search tabs", async () => {
  const friends = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");
  assert.match(friends, /"friends" \| "requests" \| "search"/);
  assert.match(friends, />\s*أصدقائي/);
  assert.match(friends, />\s*الطلبات/);
  assert.match(friends, />\s*البحث/);
  const searchHub = friends.slice(friends.indexOf('tab === "search"'), friends.indexOf("export function FriendProfile"));
  assert.match(searchHub, /friend-search/);
  assert.match(friends, /friend-request-badge/);
});

test("dedicated friends and lists hubs are routed outside main profile", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /path="friends" element={<Friends \/>}/);
  assert.match(app, /path="lists" element={<Lists \/>}/);
  assert.doesNotMatch(app, /profile#account-friends/);
  assert.doesNotMatch(app, /profile#account-lists/);
});

test("profile backend aggregates stats and caps main profile previews", async () => {
  const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const start = api.indexOf("async function getUserProfileView");
  const end = api.indexOf("async function getAvatarLibrary", start);
  const profile = api.slice(start, end);

  assert.match(profile, /GROUP BY manga_id, chapter/);
  assert.match(profile, /status = 'completed'/);
  assert.match(profile, /status = 'reading'/);
  assert.match(profile, /COUNT\(\*\) FROM user_lists WHERE user_id = \?/);
  assert.match(profile, /getUserActivity\(db, targetId, 3, 0\)/);
  assert.match(profile, /row_number <= 4/);
  assert.match(profile, /friend_requests WHERE receiver_id = \?/);
  assert.match(profile, /if \(access === "private"\) return profile;/);

  const privateStop = profile.indexOf('if (access === "private") return profile;');
  const statsQuery = profile.indexOf("chapters_read");
  assert.ok(privateStop >= 0 && statsQuery > privateStop);
});

test("favorites are a system list preview but not part of personal list count", async () => {
  const [overview, api] = await Promise.all([
    readFile(new URL("../src/components/ProfileOverview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8"),
  ]);
  assert.match(overview, /name: "المفضلة"/);
  assert.match(overview, /system: true/);
  assert.match(api, /\(SELECT COUNT\(\*\) FROM user_lists WHERE user_id = \?\) AS lists/);
});

test("private profile shell never renders public summary, stats or progress branch", async () => {
  const friends = await readFile(new URL("../src/pages/Friends.tsx", import.meta.url), "utf8");
  const start = friends.indexOf("export function FriendProfile");
  const view = friends.slice(start);
  assert.match(view, /isPrivate \? \(/);
  assert.match(view, /<FavoritesSection profile={profile}/);
  assert.match(view, /: profile\.stats \? \(/);
});

test("profile header keeps friends and settings in the identity row without a summary strip", async () => {
  const [overview, account] = await Promise.all([
    readFile(new URL("../src/components/ProfileOverview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(overview, /className="profile-header-friends"/);
  assert.match(overview, />الأصدقاء</);
  assert.doesNotMatch(overview, /ProfileSummaryStrip/);
  assert.doesNotMatch(account, /Icon name="more"/);
  assert.match(account, /Icon name="settings"/);
});

test("profile reading stats stay in one compact three-column row on mobile", async () => {
  const [overview, css] = await Promise.all([
    readFile(new URL("../src/components/ProfileOverview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/profileOverview.css", import.meta.url), "utf8"),
  ]);
  assert.match(overview, /"فصول مقروءة"/);
  assert.match(overview, /"قصص مكتملة"/);
  assert.match(overview, /"أقرأ الآن"/);
  assert.doesNotMatch(overview, /"إجمالي القصص"/);
  const compact = css.slice(css.indexOf("Compact profile shell: one-row identity and stats"));
  assert.match(compact, /\.profile-stats-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(
    compact,
    /@media \(max-width: 759px\)[\s\S]*?\.profile-stats-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
});

test("profile customization moves from the header menu to a pencil by lists", async () => {
  const [account, overview, ui] = await Promise.all([
    readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ProfileOverview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UI.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(account, /onCustomize=\{\(\) => setCustomizing\(true\)\}/);
  assert.match(overview, /className="profile-section-edit"/);
  assert.match(overview, /Icon name="edit"/);
  assert.match(ui, /edit:/);
});

test("profile display name stays right-aligned beside the avatar", async () => {
  const css = await readFile(new URL("../src/profileOverview.css", import.meta.url), "utf8");
  const compact = css.slice(css.indexOf("Compact profile shell: one-row identity and stats"));
  assert.match(
    compact,
    /\.profile-overview-name \{[\s\S]*?text-align: right;[\s\S]*?\.profile-overview-name h1 \{[\s\S]*?text-align: right;/,
  );
});

test("profile source failures stay inside their own preview sections", async () => {
  const [account, overview] = await Promise.all([
    readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ProfileOverview.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(account, /worksError/);
  assert.match(account, /readingError/);
  assert.match(account, /setWorksRetry/);
  assert.match(account, /setReadingRetry/);
  assert.match(overview, /onRetry\?: \(\) => void/);
  assert.match(overview, /profile-section-error compact/);
});
