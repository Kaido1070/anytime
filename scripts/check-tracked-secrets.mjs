import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// This checks tracked paths, not only dist. Schema-only migrations remain
// permitted; D1 exports, credentials, and local secret files do not.
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const prohibited = tracked.filter(path =>
  /(?:^|\/)\.env(?:\..*)?$/i.test(path) && !/(?:^|\/)\.env\.example$/i.test(path)
  || /(?:^|\/)(?:credentials|secrets|tokens|login|mapping)(?:\.local)?\.(?:json|txt|csv|sql)$/i.test(path)
  || /(?:^|\/)(?:wany[-_](?:backup|export|import|private|fixed)|d1[-_](?:backup|export|dump)|database[-_](?:backup|export|dump))[^/]*$/i.test(path)
  || /\.(?:sqlite|sqlite3|db|dump|bak|pem|p12|pfx|key)$/i.test(path)
  || /(?:^|\/)(?:private-migrations|wany-private)\//i.test(path)
);
if (prohibited.length) {
  console.error("SECURITY: tracked private or database-export filenames detected:", prohibited.join(", "));
  process.exitCode = 1;
}

// Prevent hard-coded credentials accidentally entering the web application.
// Report only paths, never the matching value, to keep CI logs clean.
const sourcePaths = tracked.filter(path => /^(?:src|public|functions)\//.test(path) && /\.(?:js|jsx|ts|tsx|json|html)$/.test(path));
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|GITHUB_TOKEN|GH_TOKEN)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/,
  /(?:password|recoveryCode|sessionToken)\s*[:=]\s*["'][A-Za-z0-9_!@#$%^&*.-]{24,}["']/i,
];
for (const path of sourcePaths) {
  const body = readFileSync(path, "utf8");
  if (patterns.some(re => re.test(body))) {
    console.error("SECURITY: possible hard-coded secret in", path);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log("Tracked-file secret and private D1 export guard passed.");
