import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkPublicFiles(root) {
  let entries;
  try { entries = await readdir(root, { recursive: true, withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const forbidden = entries.filter(entry => entry.isFile()).map(entry =>
    relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .filter(path => /\.(?:sql|sqlite3?|db|zip|bak)$/i.test(path)
      || /(?:^|\/)(?:\.env(?:\..*)?|login\.txt|credentials(?:\.local)?\.json|mapping\.local\.json)$/i.test(path)
      || /(?:^|\/)(?:wany-private|private-migrations)(?:\/|$)/i.test(path));
  if (forbidden.length) throw new Error(`Private files cannot be published from ${root}: ${forbidden.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const root of process.argv.slice(2)) await checkPublicFiles(root);
}
