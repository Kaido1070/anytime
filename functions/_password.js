// Temporary, read-only compatibility for the three known legacy credentials.
// Remove only after D1 confirms all affected credentials have been upgraded.
const LEGACY_VERIFICATION_HASHES = new Map([
  ["Ojgf5jLh9y8VI5U-4pGqRufZI_A2SaO-ichqcQHpnZE", "dN13h-kpkhGSQJVBkmDOvXb69LKMwGicgTtea0zEAdE"],
  ["g4QHWy3pBRzBASWHvjEIMvbwUOXfkQSD5MXPczihp3Y", "hb284Iod4PzsMFaR1UF0ZeovMGnQi2XHETuB_oPGFLU"],
  ["Yf2ROKbhijCsK3zEOivfkaCa3Rdw_VSmG524d3G-nwI", "a6i7k3yCu28zBKb6rGpJFeJLV8WmWRn3wH18pGbrwWc"],
]);

export const PASSWORD_ITERATIONS = 25000;

export async function verifyPassword(password, row) {
  // Preserve the existing legacy bridge without ever writing credentials.
  const compatibleHash = Number(row.password_iterations) === 210000
    ? LEGACY_VERIFICATION_HASHES.get(String(row.password_hash)) : null;
  const iterations = compatibleHash ? PASSWORD_ITERATIONS : Number(row.password_iterations);
  const derived = await derivePasswordHash(password, base64UrlToBytes(row.password_salt), iterations);
  const expected = base64UrlToBytes(compatibleHash ?? row.password_hash);
  const actual = base64UrlToBytes(derived);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

export async function derivePasswordHash(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Invalid credential parameters.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  return Uint8Array.from(atob(String(value).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
