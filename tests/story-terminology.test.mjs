import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test("user-facing copy uses قصة/قصص instead of عمل/أعمال", async () => {
  const src = path.resolve(new URL("../src", import.meta.url).pathname);
  const files = await sourceFiles(src);
  const violations = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (!/(?:الأعمال|أعمال|عمل)/.test(line)) return;
      const isBusinessGenre =
        file.endsWith(path.join("pages", "Discover.tsx")) &&
        line.includes('id: "business"') &&
        line.includes('label: "أعمال"');
      if (!isBusinessGenre) {
        violations.push(`${path.relative(src, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, []);
});
