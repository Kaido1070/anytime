import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("profile keeps a compact main page with dedicated lists and friends hubs", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/layouts/AppLayout.tsx", import.meta.url), "utf8");
  const account = await readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8");

  assert.match(app, /path="profile" element={<Account \/>}/);
  assert.match(app, /path="lists" element={<Lists \/>}/);
  assert.match(app, /path="friends" element={<Friends \/>}/);
  assert.match(app, /path="friends\/:id" element={<FriendProfile \/>}/);
  assert.doesNotMatch(layout, /label: "الرئيسية"/);
  assert.doesNotMatch(layout, /label: "القوائم"/);
  assert.doesNotMatch(layout, /label: "الأصدقاء"/);
  assert.match(layout, /label: "حسابي"/);

  assert.doesNotMatch(account, /ProfileSummaryStrip/);
  assert.match(account, /ProfileStatsSection/);
  assert.match(account, /ProfileListsSection/);
  assert.match(account, /ProfileReadingSection/);
  assert.match(account, /ProfileActivitySection/);
  assert.doesNotMatch(account, /<Home embedded \/>/);
  assert.doesNotMatch(account, /<Lists embedded \/>/);
  assert.doesNotMatch(account, /<Friends embedded \/>/);
  assert.match(account, /if \(settingsOpen\)/);
  assert.match(account, /<Profile embedded hideIdentityEditor \/>/);
});

test("successful sign-in routes to account home before the old chapter can mount", async () => {
  const login = await readFile(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");
  const library = await readFile(new URL("../src/hooks/useLibrary.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(login, /await signIn\([\s\S]*?navigate\(user\.role === "admin" \? "\/admin" : "\/profile", \{ replace: true \}\)/);
  assert.match(library, /const nextUser = await service\.signIn\(username, password\);\s*\/\/[^\n]*\n(?:[^\n]*\n)*?\s*onAuthenticated\?\.\(nextUser\);\s*setUser\(nextUser\);/);
  assert.match(app, /path="profile" element=\{<Account \/>\}/);
});

test("failed sign-in never invokes the post-auth redirect", async () => {
  const library = await readFile(new URL("../src/hooks/useLibrary.tsx", import.meta.url), "utf8");
  const auth = library.indexOf("const nextUser = await service.signIn(username, password);");
  const redirect = library.indexOf("onAuthenticated?.(nextUser);", auth);
  const mounted = library.indexOf("setUser(nextUser);", redirect);
  assert.ok(auth >= 0 && redirect > auth && mounted > redirect);
});
