const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const ASQ_BASE = "https://3asq.online";
const STARZ_BASE = "https://starzmanga.com";
const XSANO_BASE = "https://www.xsano-manga.com";
const MANGALIK_BASE = "https://mangalik.net";
const MANGADAR_BASE = "https://mangadar.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequestGet({ request, env }) {
  if (!env?.DB) {
    return json({ error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع." }, 503);
  }
  if (!(await getSession(request, env.DB))) {
    return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  }

  const url = new URL(request.url);
  const key = String(url.searchParams.get("key") ?? "").trim();
  if (!/^(?:mt|aq|sz|xs|ml|md):[A-Za-z0-9_-]{1,110}$/.test(key)) {
    return json({ error: "INVALID_SOURCE_KEY" }, 400);
  }

  const item = await env.DB
    .prepare("SELECT source_key, source, slug, url, cover_url FROM source_items WHERE source_key = ? LIMIT 1")
    .bind(key)
    .first();

  if (!item || !["mangatime", "3asq", "starzmanga", "xsano", "mangalik", "mangadar"].includes(String(item.source))) {
    return json({ error: "SOURCE_ITEM_NOT_FOUND" }, 404);
  }

  const source = String(item.source);
  const base = source === "3asq" ? ASQ_BASE
    : source === "starzmanga" ? STARZ_BASE
    : source === "xsano" ? XSANO_BASE
    : source === "mangalik" ? MANGALIK_BASE
    : source === "mangadar" ? MANGADAR_BASE
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

    if (source === "3asq" || source === "starzmanga" || source === "mangalik" || source === "mangadar") {
      const detailBase = source === "3asq" ? ASQ_BASE : source === "starzmanga" ? STARZ_BASE : source === "mangalik" ? MANGALIK_BASE : MANGADAR_BASE;
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
      { covers: buildCoverCandidates(storedCover) },
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
