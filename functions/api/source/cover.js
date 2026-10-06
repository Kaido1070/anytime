import { createSourceFetcher } from "../../_source-transport.js";
const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const ASQ_BASE = "https://3asq.online";
const STARZ_BASE = "https://starzmanga.com";
const XSANO_BASE = "https://www.xsano-manga.com";
const MANGALIK_BASE = "https://mangalik.net";
const AZORA_BASE = "https://azorafly.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequestGet(context) {
  return createCoverHandler(context.request.signal)(context);
}

// Cover probes and fallback attempts share one bounded request budget.
function createCoverHandler(requestSignal) {
const fetch = createSourceFetcher({ requestSignal, maxRequests: 24, maxBodyBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, deadlineMs: 30_000 });

async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع." }, 503);
  }
  if (!(await getSession(request, env.DB))) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }

  const url = new URL(request.url);
  const key = String(url.searchParams.get("key") ?? "").trim();
  if (!/^(?:mt|aq|sz|xs|ml|az):[A-Za-z0-9_-]{1,110}$/.test(key)) {
    return json({ error: "INVALID_SOURCE_KEY" }, 400);
  }

  const item = await env.DB
    .prepare("SELECT source_key, source, slug, url, cover_url FROM source_items WHERE source_key = ? LIMIT 1")
    .bind(key)
    .first();

  if (!item || !["mangatime", "3asq", "starzmanga", "xsano", "mangalik", "azora"].includes(String(item.source))) {
    return json({ error: "SOURCE_ITEM_NOT_FOUND" }, 404);
  }

  const source = String(item.source);
  const base = source === "3asq" ? ASQ_BASE
    : source === "starzmanga" ? STARZ_BASE
    : source === "xsano" ? XSANO_BASE
    : source === "mangalik" ? MANGALIK_BASE
    : source === "azora" ? AZORA_BASE
    : MANGATIME_BASE;
  const storedCover = absoluteUrl(base, item.cover_url);

  try {
    if (source === "xsano") {
      const detailCovers = await bloggerDetailCovers(String(item.url || ""));
      const stableCover = detailCovers[0] || storedCover;
      const covers = buildCoverCandidates(...detailCovers, storedCover);

      if (stableCover) {
        await env.DB
          .prepare("UPDATE source_items SET cover_url = ?, updated_at = ? WHERE source_key = ?")
          .bind(stableCover, Date.now(), key)
          .run()
          .catch(() => undefined);
      }

      return json({ covers }, 200, { "Cache-Control": "private, max-age=3600" });
    }

    if (source === "azora") {
      const detailCovers = await azoraDetailCovers(String(item.slug || ""));
      const safeStoredCover =
        storedCover && !isAzoraSocialPreviewUrl(storedCover) ? storedCover : "";
      const stableCover = detailCovers[0] || safeStoredCover;
      const covers = [...new Set([...detailCovers, safeStoredCover].filter(Boolean))];

      if (stableCover) {
        await env.DB
          .prepare("UPDATE source_items SET cover_url = ?, updated_at = ? WHERE source_key = ?")
          .bind(stableCover, Date.now(), key)
          .run()
          .catch(() => undefined);
      }

      return json({ covers }, 200, { "Cache-Control": "private, max-age=3600" });
    }

    if (source === "3asq" || source === "starzmanga" || source === "mangalik") {
      const detailBase = source === "3asq" ? ASQ_BASE : source === "starzmanga" ? STARZ_BASE : MANGALIK_BASE;
      const detailCovers = await madaraDetailCovers(detailBase, String(item.slug || ""));
      const stableCover = detailCovers[0] || storedCover;
      const covers = buildCoverCandidates(...detailCovers, storedCover);

      if (stableCover) {
        await env.DB
          .prepare("UPDATE source_items SET cover_url = ?, updated_at = ? WHERE source_key = ?")
          .bind(stableCover, Date.now(), key)
          .run()
          .catch(() => undefined);
      }

      return json({ covers }, 200, { "Cache-Control": "private, max-age=3600" });
    }

    const detail = await mangaTimeTrpc("content.getSeriesBySlug", { slug: String(item.slug || "") });
    const detailCover = absoluteUrl(MANGATIME_BASE, detail?.coverUrl) || storedCover;
    const covers = buildCoverCandidates(detailCover, storedCover);

    if (detailCover) {
      await env.DB
        .prepare("UPDATE source_items SET cover_url = ?, updated_at = ? WHERE source_key = ?")
        .bind(detailCover, Date.now(), key)
        .run()
        .catch(() => undefined);
    }

    return json({ covers }, 200, { "Cache-Control": "private, max-age=3600" });
  } catch (error) {
    console.error(source === "mangatime" ? "MangaTime cover resolver error" : `${source} cover resolver error`, error);
    return json(
      {
        covers:
          source === "azora"
            ? []
            : buildCoverCandidates(storedCover),
      },
      200,
      { "Cache-Control": "private, max-age=300" },
    );
  }
}

function buildCoverCandidates(...candidates) {
  const values = [];
  const add = (value) => {
    if (value && !values.includes(value)) values.push(value);
  };

  for (const value of candidates) {
    if (!value) continue;
    const original = unwrapAndMaximize(value);
    add(original);
    add(value);
  }

  return values;
}

function unwrapAndMaximize(value) {
  let current = value;

  try {
    let parsed = new URL(current);
    if (/\/_next\/image$/i.test(parsed.pathname)) {
      const nested = parsed.searchParams.get("url");
      if (nested) {
        current = absoluteUrl(parsed.origin, decodeURIComponent(nested)) || current;
        parsed = new URL(current);
      }
    }

    const resizeParams = [
      "w", "width", "h", "height", "q", "quality", "fit", "crop",
      "resize", "format", "fm", "dpr", "auto",
    ];
    for (const key of resizeParams) parsed.searchParams.delete(key);

    parsed.pathname = parsed.pathname
      .replace(/\/(?:thumb|thumbnail|thumbnails|small|medium)\//gi, "/")
      .replace(/(?:_|-)(?:thumb|thumbnail)(?=\.[a-z0-9]{2,5}$)/i, "")
      .replace(/[-_]\d{2,4}x\d{2,4}(?=\.[a-z0-9]{2,5}$)/i, "")
      .replace(/\/w\d+\//i, "/s0/")
      .replace(/\/s\d+(?:-c)?\//i, "/s0/")
      .replace(/=w\d+$/i, "=s0")
      .replace(/=s\d+(?:-c)?$/i, "=s0");

    return parsed.toString();
  } catch {
    return current;
  }
}

async function bloggerDetailCovers(itemUrl) {
  const target = new URL(itemUrl || "/", XSANO_BASE);
  const response = await fetch(target, {
    headers: sourceHeaders(
      XSANO_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`XSano cover HTTP ${response.status}`);

  const html = await response.text();
  const marker = html.search(/<main\b/i);
  const scoped = marker >= 0 ? html.slice(marker) : html;
  const imageMatch = scoped.match(/<img\b([^>]*)>/i);
  if (!imageMatch) return [];

  const attrs = parseAttrs(imageMatch[1]);
  const candidates = [];
  const add = (value) => {
    const absolute = absoluteUrl(XSANO_BASE, decodeEntities(value));
    if (absolute && !candidates.includes(absolute) && !absolute.startsWith("data:")) {
      candidates.push(absolute);
    }
  };

  add(attrs["data-src"]);
  add(attrs["data-lazy-src"]);
  for (const value of srcsetCandidates(attrs.srcset)) add(value);
  add(attrs.src);
  return candidates;
}

function isAzoraSocialPreviewUrl(url) {
  const value = String(url || "");
  return /(?:^|[\/_-])(?:og|opengraph|open-graph|social|share|preview|card)(?:[\/_?.-]|$)/i.test(value) ||
    /(?:api|generate)[\/_-]?(?:og|image|card)/i.test(value);
}

async function azoraDetailCovers(slug) {
  const target = new URL("/series/" + encodeURIComponent(slug), AZORA_BASE);
  const response = await fetch(target, {
    headers: sourceHeaders(
      AZORA_BASE,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Azora cover HTTP " + response.status);

  const html = await response.text();
  const title = decodeEntities(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const unwrap = (value) => {
    let current = absoluteUrl(AZORA_BASE, decodeEntities(String(value || ""))
      .replace(/\\u002[fF]/gi, "/")
      .replace(/\\u003[aA]/gi, ":")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/"));
    for (let depth = 0; depth < 4 && current; depth += 1) {
      try {
        const parsed = new URL(current);
        const nested =
          parsed.searchParams.get("url") ||
          parsed.searchParams.get("src") ||
          parsed.searchParams.get("image") ||
          parsed.searchParams.get("imageUrl") ||
          parsed.searchParams.get("image_url");
        if (!nested) break;
        let decoded = nested;
        try { decoded = decodeURIComponent(nested); } catch {}
        const next = absoluteUrl(parsed.origin, decoded);
        if (!next || next === current) break;
        current = next;
      } catch {
        break;
      }
    }
    return current || "";
  };

  const candidates = [];
  const seen = new Set();
  const add = (value, attrs = {}, kind = "img") => {
    const url = unwrap(value);
    if (!url || seen.has(url) || url.startsWith("data:")) return;
    if (/(?:logo|favicon|avatar|profile|banner|icon|badge|placeholder|sprite|emoji|ads?)(?:[\/_-]|\.)/i.test(url)) return;
    if (isAzoraSocialPreviewUrl(url)) return;

    const label = decodeEntities(String(attrs.alt || attrs.title || ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const className = String(attrs.class || "");
    const width = Number.parseFloat(attrs.width || "");
    const height = Number.parseFloat(attrs.height || "");
    let score = 0;

    if (title && label === title) score += 14;
    else if (title && label && (label.includes(title) || title.includes(label))) score += 8;
    if (kind === "background") score += 16;
    if (kind === "source") score += 5;
    if (/(?:cover|poster|thumbnail|thumb|series|manga)/i.test(className)) score += 6;
    if (/(?:cover|poster|thumbnail|thumb)/i.test(url)) score += 4;
    if (/\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) score += 1;

    // Azora's SEO card is landscape. Reject it even if its alt matches title.
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      if (width >= height * 1.15) return;
      if (height > width * 1.15) score += 10;
    }

    if (score < 1) return;
    seen.add(url);
    candidates.push({ url, score });
  };

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    add(attrs["data-src"], attrs);
    add(attrs["data-lazy-src"], attrs);
    add(attrs["data-original"], attrs);
    add(attrs["data-url"], attrs);
    for (const value of srcsetCandidates(attrs["data-srcset"])) add(value, attrs);
    for (const value of srcsetCandidates(attrs.srcset)) add(value, attrs);
    add(attrs.src, attrs);
  }

  for (const match of html.matchAll(/\b(?:style|data-bg|data-background|data-background-image)=["']([^"']+)["']/gi)) {
    const raw = match[1];
    const urls = [...raw.matchAll(/url\(\s*["']?([^"'\)]+)["']?\s*\)/gi)].map((entry) => entry[1]);
    if (!urls.length && /^https?:\/\//i.test(raw.trim())) urls.push(raw.trim());
    for (const value of urls) add(value, {}, "background");
  }

  for (const match of html.matchAll(/<source\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    for (const value of srcsetCandidates(attrs["data-srcset"])) add(value, attrs, "source");
    for (const value of srcsetCandidates(attrs.srcset)) add(value, attrs, "source");
    add(attrs.src, attrs, "source");
  }

  candidates.sort((a, b) => b.score - a.score);
  const resolved = [];
  for (const candidate of candidates.slice(0, 12)) {
    let imageResponse;
    try {
      imageResponse = await fetch(candidate.url, {
        headers: sourceHeaders(AZORA_BASE, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"),
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
    } catch {
      continue;
    }
    const type = String(imageResponse.headers.get("Content-Type") || "").toLowerCase();
    try { await imageResponse.body?.cancel(); } catch {}
    if (!imageResponse.ok || !type.startsWith("image/")) continue;
    if (!resolved.includes(candidate.url)) resolved.push(candidate.url);
    if (resolved.length >= 4) break;
  }

  return resolved;
}

async function madaraDetailCovers(base, slug) {
  const target = new URL(`/manga/${encodeURIComponent(slug)}/`, base);
  const response = await fetch(target, {
    headers: sourceHeaders(
      base,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    redirect: "follow",
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Madara cover HTTP ${response.status}`);

  const html = await response.text();
  const summary =
    firstMatch(html, /<div\b[^>]*class=["'][^"']*\bsummary_image\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html;

  const imageMatch = summary.match(/<img\b([^>]*)>/i);
  if (!imageMatch) return [];

  const attrs = parseAttrs(imageMatch[1]);
  const candidates = [];

  const add = (value) => {
    const absolute = absoluteUrl(base, decodeEntities(value));
    if (absolute && !candidates.includes(absolute) && !absolute.startsWith("data:")) {
      candidates.push(absolute);
    }
  };

  add(attrs["data-src"]);
  add(attrs["data-lazy-src"]);

  for (const value of srcsetCandidates(attrs.srcset)) add(value);
  add(attrs.src);

  return candidates;
}

function srcsetCandidates(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => {
      const [url, descriptor = ""] = entry.trim().split(/\s+/, 2);
      const width = Number.parseInt(descriptor, 10) || 0;
      return { url, width };
    })
    .filter((entry) => entry.url)
    .sort((a, b) => b.width - a.width)
    .map((entry) => entry.url);
}

function parseAttrs(value) {
  const attrs = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = regex.exec(String(value || "")))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function firstMatch(value, regex) {
  return String(value || "").match(regex)?.[1] || "";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

async function mangaTimeTrpc(endpoint, input) {
  const headers = sourceHeaders(MANGATIME_BASE, "application/json,text/plain,*/*");
  const attempts = [
    {
      batched: false,
      url: (() => {
        const value = new URL(`${MANGATIME_BASE}/api/trpc/${endpoint}`);
        value.searchParams.set("input", JSON.stringify({ json: input }));
        return value;
      })(),
    },
    {
      batched: true,
      url: (() => {
        const value = new URL(`${MANGATIME_BASE}/api/trpc/${endpoint}`);
        value.searchParams.set("batch", "1");
        value.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
        return value;
      })(),
    },
  ];

  let lastError = "MangaTime API error";
  for (const attempt of attempts) {
    let response;
    try {
      response = await fetch(attempt.url, {
        headers,
        redirect: "follow",
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (!response.ok) {
      lastError = `MangaTime HTTP ${response.status}`;
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      lastError = "MangaTime returned invalid JSON";
      continue;
    }

    const envelope = attempt.batched
      ? (Array.isArray(payload) ? payload[0] : null)
      : (Array.isArray(payload) ? payload[0] : payload);
    if (envelope?.error) {
      lastError = envelope.error?.json?.message || envelope.error?.message || "MangaTime API error";
      continue;
    }

    const data = envelope?.result?.data?.json;
    if (data !== undefined) return data;
    lastError = "MangaTime returned an empty response";
  }

  throw new Error(lastError);
}

function sourceHeaders(base, accept) {
  return {
    Accept: accept,
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: `${base}/`,
    "User-Agent": SOURCE_UA,
    ...(base === MANGATIME_BASE
      ? {
          "X-MT-Platform": "web",
          "X-MT-UIMode": "standard",
        }
      : {}),
  };
}

function absoluteUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(String(value).trim().replaceAll(" ", "%20"), base).toString();
  } catch {
    return "";
  }
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  return db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1")
    .bind(tokenHash, Date.now())
    .first();
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}


return onRequestGet;
}
