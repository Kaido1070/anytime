import { createSourceFetcher } from "../../_source-transport.js";
import { onRequest as handleSourceRequest } from "./[[path]].js";

const TEAMX_BASE = "https://olympustaff.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Exact SHA-256 fingerprints of the user-approved Team-X promo images.
// Match the binary itself instead of canvas dimensions because Team-X may render
// the same promo at different display sizes or omit width/height metadata.
const BLOCKED_TEAMX_IMAGE_HASHES = new Set([
  "39ed77a599e8f8078628a2e349a003380342125af39c55bc9e6139405fbbc190",
  "7654f3184ab27288688d8d317c651feaa28ffa64e03d54c071e55e99196fbd89",
]);
const teamXBannerResultCache = new Map();

export async function onRequest(context) {
  // Core adapters and the Team-X recovery/filter share the same request budget.
  const fetchSource = createSourceFetcher({ requestSignal: context.request.signal });
  const response = await handleSourceRequest({ ...context, sourceFetcher: fetchSource });
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
    const upstream = await fetchSource(new URL(chapterUrl, TEAMX_BASE).toString(), {
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

    // Remove approved promo images by exact binary fingerprint. Do not rely on
    // canvas dimensions: the same asset can be displayed at different sizes.
    pageMeta = await filterKnownTeamXBanners(pageMeta, chapterUrl, fetchSource);

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

async function filterKnownTeamXBanners(pageMeta, chapterUrl, fetchSource) {
  const blocked = new Set();
  if (!pageMeta.length) return pageMeta;

  // Check the final canvas first: Team-X sometimes appends a dead image
  // element after the real chapter. The shared transport has a byte budget,
  // so checking it after dozens of full-sized pages could silently skip it.
  const lastIndex = pageMeta.length - 1;
  if (await isKnownTeamXBanner(pageMeta[lastIndex], chapterUrl, fetchSource)) {
    blocked.add(lastIndex);
  }

  const indices = Array.from(
    { length: Math.min(pageMeta.length - 1, 63) },
    (_, index) => index,
  ).filter((index) => index !== lastIndex);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, indices.length) }, async () => {
    while (cursor < indices.length) {
      const index = indices[cursor++];
      if (await isKnownTeamXBanner(pageMeta[index], chapterUrl, fetchSource)) blocked.add(index);
    }
  });
  await Promise.all(workers);
  return pageMeta.filter((_, index) => !blocked.has(index));
}

async function isKnownTeamXBanner(page, chapterUrl, fetchSource) {
  const cached = teamXBannerResultCache.get(page.url);
  if (cached !== undefined) return cached;

  try {
    const response = await fetchSource(page.url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: chapterUrl,
        "User-Agent": SOURCE_UA,
      },
      redirect: "follow",
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    // An explicitly missing file or an HTML/JSON response is not a chapter
    // image. Do not exclude 403/429/5xx: these can be temporary hotlink or
    // upstream failures, and the reader must retain a retry path for them.
    const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
    if (response.status === 404 || response.status === 410) {
      // Do not cache missing-file decisions: a source may restore the image.
      return true;
    }
    if (!response.ok) return false;
    if (/^(?:text\/html|text\/plain|application\/(?:json|xml|xhtml\+xml))\b/.test(contentType)) {
      // A temporary HTML challenge must not permanently remove a page.
      return true;
    }

    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const blocked = BLOCKED_TEAMX_IMAGE_HASHES.has(bytesToHex(new Uint8Array(digest)));

    teamXBannerResultCache.set(page.url, blocked);
    if (teamXBannerResultCache.size > 256) {
      const oldest = teamXBannerResultCache.keys().next().value;
      if (oldest) teamXBannerResultCache.delete(oldest);
    }
    return blocked;
  } catch {
    // Fail open: if verification cannot be completed, keep the chapter readable.
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
  const source = String(html ?? "");
  const marker = source.search(
    /<div\b[^>]*class=["'][^"']*\bimage_list\b[^"']*["'][^>]*>/i,
  );
  if (marker < 0) return [];

  // Only read descendants of image_list. Previously the parser scanned all
  // the way to <footer>, including unrelated linked recommendations/promos.
  const scoped = teamXImageListHtml(source.slice(marker, marker + 2_500_000));
  if (!scoped) return [];

  const canvasPages = extractTeamXPageTags(scoped, "canvas");
  if (canvasPages.length) return uniquePageMeta(canvasPages);

  return uniquePageMeta(extractTeamXPageTags(scoped, "img")).filter(
    (page) => !/logo|avatar|favicon|icon|profile|(?:^|[\/_-])ads?(?:[\/_-]|\.)|banner/i.test(page.url),
  );
}

// Return exactly the balanced image_list container, not its sibling content.
// Track nested divs; unrelated links outside the reader cannot become pages.
function teamXImageListHtml(html) {
  const tags = /<\/?div\b[^>]*>/gi;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<\/div\b/i.test(match[0])) {
      depth--;
      if (depth === 0) return html.slice(0, tags.lastIndex);
    } else {
      depth++;
    }
  }
  return html; // Fail open for malformed source HTML.
}

// Keep linked promotions out of the chapter, even when they sit inside the
// image_list. A chapter image does not link to a different series/novel.
function extractTeamXPageTags(html, tag) {
  const pages = [];
  const token = /<\/?a\b[^>]*>|<(?:canvas|img)\b[^>]*>/gi;
  const links = [];
  let match;
  while ((match = token.exec(html))) {
    const element = match[0];
    if (/^<\/a\b/i.test(element)) {
      links.pop();
      continue;
    }
    if (/^<a\b/i.test(element)) {
      const href = readAttr(element, "href");
      links.push(isTeamXPromotionalLink(href));
      continue;
    }
    if (!new RegExp(`^<${tag}\\b`, "i").test(element)) continue;
    if (links.some(Boolean)) continue;
    const url = readAttr(element, "data-src") ||
      readAttr(element, "data-lazy-src") ||
      (tag === "img" ? readAttr(element, "src") : "");
    if (!url || isTeamXPromoAsset(url)) continue;
    const width = tag === "canvas" ? readCanvasDimension(element, "width") : undefined;
    const height = tag === "canvas" ? readCanvasDimension(element, "height") : undefined;
    pages.push({
      url,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  return pages;
}

function isTeamXPromotionalLink(href) {
  if (!href) return false;
  try {
    const url = new URL(href, TEAMX_BASE);
    // Ignore only unrelated content links, not normal image CDN links.
    // Real reader pages may link to their full-resolution image. A link
    // to any HTML page, other chapter, novel, or external landing page is
    // promotional/navigation content rather than a chapter image.
    return !/\.(?:jpe?g|png|webp|gif|avif|bmp|svg)(?:$|[?#])/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isTeamXPromoAsset(url) {
  // The known recurring Lord of Truth novel banner is not a manga page.
  return /lord[-_\s]*(?:of[-_\s]*)?(?:the[-_\s]*)?truth/i.test(url);
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


export const __test = { filterKnownTeamXBanners };
