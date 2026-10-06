import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPublicFiles } from "../scripts/check-public-files.mjs";

test("publication rejects private exports and login details, including nested files", async () => {
  const root = await mkdtemp(join(tmpdir(), "wany-public-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "index.html"), "<html></html>");
    await writeFile(join(root, "nested", "asset.js"), "export default 1;");
    await checkPublicFiles(root);
    for (const name of ["wany-fixed.sql", "wany-test.zip", "login.txt", "credentials.local.json", ".env", "database.sqlite"]) {
      const file = join(root, "nested", name);
      await writeFile(file, "private fixture");
      await assert.rejects(checkPublicFiles(root), /Private files cannot be published/);
      await rm(file);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
