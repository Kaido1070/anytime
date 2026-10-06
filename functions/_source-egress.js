import { isPublicImageUrl } from './_image-security.js';

// Reviewed exact destinations, not domains supplied by a request or learnt
// automatically from HTML/redirects. Source hosts come from the adapters; CDN
// hosts come from the saved source-cache inventory. No wildcard suffixes.
const sourceHosts = new Set([
  'mangatime.org', 'www.mangatime.org',
  'olympustaff.com', 'www.olympustaff.com',
  '3asq.online', 'www.3asq.online',
  'starzmanga.com', 'www.starzmanga.com', 'starz.starzmanga.com',
  'xsano-manga.com', 'www.xsano-manga.com',
  'mangalik.net', 'www.mangalik.net', 'io.mangalik.net',
  'azorafly.com', 'www.azorafly.com', 'storage.azorafly.com',
  'cdn-stellarsaber.com', 's4.anilist.co', 'blogger.googleusercontent.com',
]);

export function isAllowedSourceUrl(value) {
  if (!isPublicImageUrl(value)) return false;
  const url = new URL(value);
  // Exact matching also rejects trailing dots, lookalike subdomains, unrelated
  // source suffixes and public IP literals. HTTPS prevents insecure downgrades.
  return url.protocol === 'https:' && !url.port && sourceHosts.has(url.hostname.toLowerCase());
}
