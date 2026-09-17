import { onRequest as handleSourceRequest } from "./[[path]].js";

const TEAMX_BASE = "https://olympustaff.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Exact SHA-256 fingerprints of the two user-approved Team-X promo images.
// Nothing else is removed. Dimensions are only a cheap pre-check before hashing.
const BLOCKED_TEAMX_IMAGES = new Map([
  ["536x1532", "39ed77a599e8f8078628a2e349a003380342125af39c55bc9e6139405fbbc190"],
  ["1280x518", "7654f3184ab27288688d8d317c651feaa28ffa64e03d54c071e55e99196fbd89"],
]);

export async function onRequest(context) {
  const response = await handleSourceRequest(context);
  if (!response.ok) return response;

  const payload = await response.clone().json().catch(() => null);
  const chapter = payload?.chapter;
  if (!chapter || chapter.item?.source !== "teamx") return response;

  const selected = chapter.item.chapters?.find(
    (entry) => Number(entry.number) === Number(chapter.number),
  );
  const chapterUrl =
    selected?.url ||
    `${String(chapter.item.url || `${TEAMX_BASE}/series/${chapter.item.slug}`).replace(/\/$/, "")}/${chapter.number}`;

  try {
    const upstream = await fetch(new URL(chapterUrl, TEAMX_BASE).toString(), {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        Referer: `${TEAMX_BASE}/`,
        "User-Agent": SOURCE_UA,
      },
      redirect: "follow",
      cf: { cacheTtl: 30, cacheEverything: true },
    });

    if (!upstream.ok) return response;
    const html = await upstream.text();
    let pageMeta = parseTeamXCanvasPageMeta(html);
    if (!pageMeta.length) return response;

    // Hash only dimension-matched candidates, then remove only an exact binary match.
    // A different page with the same dimensions is preserved.
    pageMeta = await filterKnownTeamXBanners(pageMeta, chapterUrl);

    payload.chapter.pages = pageMeta.map((page) => page.url);
    payload.chapter.pageMeta = pageMeta;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "private, max-age=30");
    return new Response(JSON.stringify(payload), {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.warn("Anytime Team-X canvas page recovery failed", error);
    return response;
  }
}

async function filterKnownTeamXBanners(pageMeta, chapterUrl) {
  return Promise.all(pageMeta.map(async (page) => ({ page, blocked: await isKnownTeamXBanner(page, chapterUrl) })))
    .then((checks) => checks.filter(({ blocked }) => !blocked).map(({ page }) => page));
}

async function isKnownTeamXBanner(page, chapterUrl) {
  const width = Math.round(Number(page.width));
  const height = Math.round(Number(page.height));
  const expectedHash = BLOCKED_TEAMX_IMAGES.get(`${width}x${height}`);
  if (!expectedHash) return false;

  try {
    const response = await fetch(page.url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: chapterUrl,
        "User-Agent": SOURCE_UA,
      },
      redirect: "follow",
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!response.ok) return false;
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest)) === expectedHash;
  } catch {
    // Fail open: if verification cannot be completed, keep the image.
    return false;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseTeamXCanvasPages(html) {
  return parseTeamXCanvasPageMeta(html).map((page) => page.url);
}

export function parseTeamXCanvasPageMeta(html) {
  const marker = String(html ?? "").search(
    /<div\b[^>]*class=["'][^"']*\bimage_list\b[^"']*["'][^>]*>/i,
  );
  if (marker < 0) return [];

  const source = String(html);
  const hardEnd = Math.min(source.length, marker + 2_500_000);
  const footer = source.slice(marker, hardEnd).search(/<footer\b/i);
  const end = footer >= 0 ? marker + footer : hardEnd;
  const scoped = source.slice(marker, end);

  const canvasPages = extractCanvasPages(scoped);
  if (canvasPages.length) return uniquePageMeta(canvasPages);

  const imagePages = extractTagUrls(scoped, "img", ["data-src", "data-lazy-src", "src"]);
  return uniquePageMeta(imagePages.map((url) => ({ url }))).filter(
    (page) => !/logo|avatar|favicon|icon|profile|(?:^|[\/_-])ads?(?:[\/_-]|\.)|banner/i.test(page.url),
  );
}

function extractCanvasPages(html) {
  const pages = [];
  const regex = /<canvas\b([^>]*)>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = match[1];
    const url = readAttr(attrs, "data-src") || readAttr(attrs, "data-lazy-src");
    if (!url) continue;

    const width = readCanvasDimension(attrs, "width");
    const height = readCanvasDimension(attrs, "height");
    pages.push({
      url,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  return pages;
}

function readCanvasDimension(attrs, name) {
  for (const attr of [name, `data-${name}`, `data-original-${name}`]) {
    const value = positiveDimension(readAttr(attrs, attr));
    if (value) return value;
  }

  const style = readAttr(attrs, "style");
  if (style) {
    const match = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)px\\b`, "i"));
    const value = positiveDimension(match?.[1]);
    if (value) return value;
  }

  return undefined;
}

function positiveDimension(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 50000) return undefined;
  return Math.round(number * 100) / 100;
}

function extractTagUrls(html, tag, attrs) {
  const urls = [];
  const regex = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  let match;
  while ((match = regex.exec(html))) {
    for (const attr of attrs) {
      const value = readAttr(match[1], attr);
      if (value) {
        urls.push(value);
        break;
      }
    }
  }
  return urls;
}

function readAttr(input, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(input).match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i"),
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function uniquePageMeta(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value?.url || value.url.startsWith("data:")) continue;
    let absolute;
    try {
      absolute = new URL(value.url.replaceAll(" ", "%20"), TEAMX_BASE).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push({
      url: absolute,
      ...(value.width ? { width: value.width } : {}),
      ...(value.height ? { height: value.height } : {}),
    });
  }
  return out;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
