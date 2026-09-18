import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../migrations/0008_avatar_library.sql", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../functions/api/[[path]].js", import.meta.url),
  "utf8",
);
const picker = await readFile(
  new URL("../src/components/AvatarPicker.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/phase8.css", import.meta.url),
  "utf8",
);
const account = await readFile(
  new URL("../src/pages/Account.tsx", import.meta.url),
  "utf8",
);
const profileOverview = await readFile(
  new URL("../src/components/ProfileOverview.tsx", import.meta.url),
  "utf8",
);
const friends = await readFile(
  new URL("../src/pages/Friends.tsx", import.meta.url),
  "utf8",
);
const activity = await readFile(
  new URL("../src/components/ActivityFeed.tsx", import.meta.url),
  "utf8",
);

test("phase 8 migration hard-caps library at 10 series and 15 avatars per series", () => {
  assert.match(
    migration,
    /position INTEGER NOT NULL UNIQUE CHECK \(position BETWEEN 1 AND 10\)/,
  );
  assert.match(
    migration,
    /position INTEGER NOT NULL CHECK \(position BETWEEN 1 AND 15\)/,
  );
  assert.match(migration, /UNIQUE \(series_id, position\)/);
  assert.match(
    migration,
    /avatar_id TEXT REFERENCES avatars\(id\) ON DELETE SET NULL/,
  );

  const seriesIds = [
    ...migration.matchAll(
      /INSERT OR IGNORE INTO avatar_series[\s\S]*?VALUES \('([^']+)'/g,
    ),
  ].map((match) => match[1]);
  assert.equal(seriesIds.length, 10);
  assert.equal(new Set(seriesIds).size, 10);

  const counts = new Map();
  for (const match of migration.matchAll(
    /\('([^']+:[^']+)','([^']+)','[^']+','anilist:[^']+',\d+,1,/g,
  )) {
    counts.set(match[2], (counts.get(match[2]) ?? 0) + 1);
  }
  assert.equal(counts.size, 10);
  for (const count of counts.values()) {
    assert.ok(count >= 1 && count <= 15);
  }
  assert.ok([...counts.values()].some((count) => count < 15));
});

test("avatar selection is validated by active avatar and active series", () => {
  assert.match(api, /path === "profile\/avatar"/);
  assert.match(api, /JOIN avatar_series s ON s\.id = a\.series_id/);
  assert.match(api, /a\.is_active = 1 AND s\.is_active = 1/);
  assert.match(
    api,
    /UPDATE users SET avatar_id = \?, updated_at = \? WHERE id = \?/,
  );

  const branch = api.slice(
    api.indexOf('path === "profile/avatar"'),
    api.indexOf('path === "profile/visibility"'),
  );
  assert.doesNotMatch(branch, /recordActivity|activity_events/);
});

test("picker is local-search, horizontal-scroll and explicit-save without upload", () => {
  assert.match(picker, /ابحث عن عمل أو شخصية/);
  assert.match(picker, /filterAvatarSeries/);
  assert.match(picker, /aria-pressed/);
  assert.match(picker, /جاري الحفظ/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /-webkit-overflow-scrolling: touch/);
  assert.doesNotMatch(
    picker,
    /type="file"|camera|custom image URL|gravatar/i,
  );
});

test("shared avatar is integrated into account, friends and activity", () => {
  assert.match(account, /ProfileIdentityHeader/);
  assert.match(profileOverview, /UserAvatar/);
  assert.match(friends, /UserAvatar/);
  assert.match(activity, /UserAvatar/);
});
