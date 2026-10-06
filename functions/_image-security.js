// Binary image routes must never serve active documents on the application's origin.
const rasterTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon']);
export function rasterImageType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return rasterTypes.has(type) ? type : null;
}
export function protectImageHeaders(headers, type) {
  headers.set('Content-Type', type);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}
export function isPublicImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || !host.includes('.') && !host.includes(':') || host === 'localhost' || /\.(?:localhost|local|internal)$/.test(host)) return false;
  if (host.includes(':')) {
    // Accept only global unicast IPv6; mapped IPv4, loopback, link-local and ULA fail closed.
    return /^[23][0-9a-f]{3}:/.test(host) && !host.startsWith('2001:db8:');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0) return false;
  }
  return true;
}
export async function fetchPublicImage(target, options = {}, fetcher = fetch) {
  let current = String(target);
  for (let hop = 0; hop <= 4; hop++) {
    if (!isPublicImageUrl(current)) throw new Error('INVALID_IMAGE_HOST');
    const result = await fetcher(current, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    const location = result.headers.get('Location');
    await result.body?.cancel();
    if (!location || hop === 4) throw new Error('INVALID_IMAGE_REDIRECT');
    current = new URL(location, current).toString();
  }
  throw new Error('INVALID_IMAGE_REDIRECT');
}
export async function readImageBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('INVALID_COVER_SIZE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
