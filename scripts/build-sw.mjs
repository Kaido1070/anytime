import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix } from "node:path";

const entries = await readdir("dist", { recursive: true, withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile())
  .map((entry) =>
    `${entry.parentPath}/${entry.name}`
      .replaceAll("\\", "/")
      .replace(/^dist\//, "/"),
  )
  .filter((path) => !path.endsWith("sw.js") && !path.includes("/_"))
  .sort();

const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(`dist${file}`));
}

const cacheVersion = hash.digest("hex").slice(0, 12);
let sw = await readFile("dist/sw.js", "utf8");

sw = sw.replace(
  /const CACHE = "anytime-shell-[^"]+";/,
  `const CACHE = "anytime-shell-${cacheVersion}";`,
);

// Precache only the account shell and its static dependencies. Deferred route
// chunks are cached when opened, so install does not download every page.
const html = await readFile("dist/index.html", "utf8");
const core = new Set(["/", "/index.html", "/manifest.webmanifest"]);
const queue = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
while (queue.length) {
  const asset = queue.pop();
  if (core.has(asset) || !files.includes(asset)) continue;
  core.add(asset);
  if (!asset.endsWith(".js")) continue;
  const code = await readFile(`dist${asset}`, "utf8");
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+\.js)["']/g)) {
    queue.push(posix.resolve(posix.dirname(asset), match[1]));
  }
}
sw = sw.replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify([...core])};`);

await writeFile("dist/sw.js", sw);
console.log(
  `PWA: cache anytime-shell-${cacheVersion}; precached ${core.size} shell assets.`,
);
