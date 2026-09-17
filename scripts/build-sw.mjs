import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const entries = await readdir("dist", { recursive: true, withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile())
  .map((entry) =>
    `${entry.parentPath}/${entry.name}`
      .replaceAll("\\", "/")
      .replace(/^dist\//, "/"),
  )
  .filter((path) => !path.endsWith("sw.js") && !path.includes("/_"));
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(`dist${file}`));
let sw = await readFile("dist/sw.js", "utf8");
sw = sw.replace(
  "anytime-shell-v1",
  `anytime-shell-${hash.digest("hex").slice(0, 12)}`,
);
sw = sw.replace(
  "const PRECACHE = [];",
  `const PRECACHE = ${JSON.stringify(["/", ...files])};`,
);
await writeFile("dist/sw.js", sw);
console.log(`PWA: precached ${files.length} local assets.`);
