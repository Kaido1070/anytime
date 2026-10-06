import { rasterImageType, protectImageHeaders, isPublicImageUrl, fetchPublicImage } from "../../_image-security.js";
const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const TEAMX_BASE = "https://olympustaff.com";
const ASQ_BASE = "https://3asq.online";
const STARZ_BASE = "https://starzmanga.com";
const XSANO_BASE = "https://www.xsano-manga.com";
const MANGALIK_BASE = "https://mangalik.net";
const AZORA_BASE = "https://azorafly.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (!/^\/api\/source\/image\/?$/.test(url.pathname)) {
    return json({ error: "NOT_FOUND" }, 404);
  }
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = env?.DB;
  if (!db) return json({ error: "D1_NOT_CONFIGURED" }, 503);

  const session = await getSession(request, db);
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const source = String(url.searchParams.get("source") ?? "").toLowerCase();
  if (source !== "mangatime" && source !== "teamx" && source !== "3asq" && source !== "starzmanga" && source !== "xsano" && source !== "mangalik" && source !== "azora") {
    return json({ error: "UNKNOWN_SOURCE" }, 400);
  }

  const base = source === "teamx"
    ? TEAMX_BASE
    : source === "3asq"
      ? ASQ_BASE
      : source === "starzmanga"
        ? STARZ_BASE
        : source === "xsano"
          ? XSANO_BASE
          : source === "mangalik"
            ? MANGALIK_BASE
            : source === "azora"
              ? AZORA_BASE
              : MANGATIME_BASE;
  const raw = String(url.searchParams.get("url") ?? "");
  const target = absoluteUrl(base, raw);
  if (!target) return json({ error: "INVALID_IMAGE_URL" }, 400);

  const parsed = new URL(target);
  if (!isPublicImageUrl(target)) {
    return json({ error: "INVALID_IMAGE_HOST" }, 400);
  }

  const referer = source === "teamx"
    ? safeTeamXReferer(url.searchParams.get("referer"))
    : source === "3asq"
      ? safeAsqReferer(url.searchParams.get("referer"))
      : source === "starzmanga"
        ? safeStarzReferer(url.searchParams.get("referer"))
        : source === "xsano"
          ? safeXsanoReferer(url.searchParams.get("referer"))
          : source === "mangalik"
            ? safeMangalikReferer(url.searchParams.get("referer"))
            : source === "azora"
              ? safeAzoraReferer(url.searchParams.get("referer"))
              : `${MANGATIME_BASE}/`;

  const imageHeaders = (refererValue = "") => {
    const headers = {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "User-Agent": SOURCE_UA,
    };
    if (refererValue) headers.Referer = refererValue;
    return headers;
  };

  const fetchImage = async (refererValue = "", bypassCache = false) => {
    try {
      return await fetchPublicImage(target, {
        headers: imageHeaders(refererValue),
        signal: AbortSignal.timeout(12_000),
        cf: source === "teamx"
          ? { cacheTtl: 0 }
          : bypassCache
            ? { cacheTtl: 0, cacheEverything: false }
            : { cacheTtl: 86400, cacheEverything: true },
      });
    } catch {
      return null;
    }
  };

  let response = await fetchImage(referer);
  let type = response?.headers.get("Content-Type") ?? "";
  const isUsableImage = () =>
    Boolean(response?.ok && rasterImageType(type));

  // Azora chapter pages can mix image hosts inside one chapter. Some storage
  // hosts reject the chapter Referer while others require it. Retry failed
  // external images against their own origin, then once without a Referer.
  // This is intentionally limited to Azora/MangaTime external CDNs.
  const sourceOrigin = new URL(base).origin;
  if (
    !isUsableImage() &&
    (source === "azora" || source === "mangatime") &&
    parsed.origin !== sourceOrigin
  ) {
    response = await fetchImage(parsed.origin + "/", true);
    type = response?.headers.get("Content-Type") ?? "";

    if (!isUsableImage()) {
      response = await fetchImage("", true);
      type = response?.headers.get("Content-Type") ?? "";
    }
  }

  if (!response) {
    return json({ error: "IMAGE_UPSTREAM", status: 0 }, 502);
  }
  if (!response.ok) {
    return json({ error: "IMAGE_UPSTREAM", status: response.status }, 502);
  }
  if (!rasterImageType(type)) {
    return json({ error: "NOT_AN_IMAGE" }, 502);
  }

  const headers = new Headers();
  protectImageHeaders(headers, rasterImageType(type));
  headers.set(
    "Cache-Control",
    source === "teamx"
      ? "private, max-age=300"
      : "private, max-age=86400, stale-while-revalidate=604800",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  const length = response.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(response.body, { status: 200, headers });
}

function safeTeamXReferer(value) {
  if (!value) return `${TEAMX_BASE}/`;
  try {
    const parsed = new URL(String(value), TEAMX_BASE);
    if (!/^(www\.)?olympustaff\.com$/i.test(parsed.hostname)) return `${TEAMX_BASE}/`;
    if (!/^\/series\//i.test(parsed.pathname)) return `${TEAMX_BASE}/`;
    return parsed.toString();
  } catch {
    return `${TEAMX_BASE}/`;
  }
}

function safeAsqReferer(value) {
  if (!value) return `${ASQ_BASE}/`;
  try {
    const parsed = new URL(String(value), ASQ_BASE);
    if (!/^(?:www\.)?3asq\.online$/i.test(parsed.hostname)) return `${ASQ_BASE}/`;
    if (!/^\/manga\//i.test(parsed.pathname)) return `${ASQ_BASE}/`;
    return parsed.toString();
  } catch {
    return `${ASQ_BASE}/`;
  }
}

function safeStarzReferer(value) {
  if (!value) return `${STARZ_BASE}/`;
  try {
    const parsed = new URL(String(value), STARZ_BASE);
    if (!/^(?:www\.)?starzmanga\.com$/i.test(parsed.hostname)) return `${STARZ_BASE}/`;
    if (!/^\/manga\//i.test(parsed.pathname)) return `${STARZ_BASE}/`;
    return parsed.toString();
  } catch {
    return `${STARZ_BASE}/`;
  }
}

function safeXsanoReferer(value) {
  if (!value) return `${XSANO_BASE}/`;
  try {
    const parsed = new URL(String(value), XSANO_BASE);
    if (!/^(?:www\.)?xsano-manga\.com$/i.test(parsed.hostname)) return `${XSANO_BASE}/`;
    return parsed.toString();
  } catch {
    return `${XSANO_BASE}/`;
  }
}

function safeAzoraReferer(value) {
  if (!value) return `${AZORA_BASE}/`;
  try {
    const parsed = new URL(String(value), AZORA_BASE);
    if (!/^(?:www\.)?azorafly\.com$/i.test(parsed.hostname)) return `${AZORA_BASE}/`;
    if (!/^\/series\//i.test(parsed.pathname)) return `${AZORA_BASE}/`;
    return parsed.toString();
  } catch {
    return `${AZORA_BASE}/`;
  }
}

function safeMangalikReferer(value) {
  if (!value) return `${MANGALIK_BASE}/`;
  try {
    const parsed = new URL(String(value), MANGALIK_BASE);
    if (!/^(?:www\.)?mangalik\.net$/i.test(parsed.hostname)) return `${MANGALIK_BASE}/`;
    if (!/^\/manga\//i.test(parsed.pathname)) return `${MANGALIK_BASE}/`;
    return parsed.toString();
  } catch {
    return `${MANGALIK_BASE}/`;
  }
}

function absoluteUrl(base, value) {
  const raw = String(value ?? "").trim().replaceAll(" ", "%20");
  if (!raw) return "";
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
}

async function getSession(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const row = await db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1")
    .bind(tokenHash, Date.now())
    .first();
  return row ? { userId: row.user_id } : null;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") ?? "";
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

