import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
test("crown only for m, check only for h and y, based on username", async () => {
  const src = await read("../src/components/AccountBadge.tsx");
  assert.match(src, /username === "m".*return "crown"/);
  assert.match(src, /username === "h" \|\| username === "y"/);
  assert.match(src, /if \(!kind\) return null/);
  assert.match(src, /var\(--accent/);
  assert.match(src, /aria-label=\{title\}/);
});
test("identity badges appear on profiles, friends, settings and activity", async () => {
  for (const path of ["../src/components/ProfileOverview.tsx", "../src/pages/Profile.tsx", "../src/pages/Friends.tsx", "../src/components/ActivityFeed.tsx"]) {
    const src = await read(path);
    assert.match(src, /<AccountBadge username=\{/);
  }
});
