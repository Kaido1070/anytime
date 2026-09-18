import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("profile and lists share one account page", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/layouts/AppLayout.tsx", import.meta.url), "utf8");
  const account = await readFile(new URL("../src/pages/Account.tsx", import.meta.url), "utf8");

  assert.match(app, /path="profile" element={<Account \/>}/);
  assert.match(app, /path="lists" element={<Navigate to="\/profile#account-lists" replace \/>}/);
  assert.doesNotMatch(layout, /label: "الرئيسية"/);
  assert.doesNotMatch(layout, /label: "القوائم"/);
  assert.match(layout, /label: "حسابي"/);

  assert.match(account, /<Home embedded \/>/);
  assert.match(account, /<Lists embedded \/>/);
  assert.match(account, /id="account-lists"/);
  assert.doesNotMatch(account, /AccountTab/);
  assert.doesNotMatch(account, /account-tabs/);
  assert.match(account, /settingsOpen \? \(/);
  assert.match(account, /<Profile embedded \/>/);
});
