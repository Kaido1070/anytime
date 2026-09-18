import { onRequest as handleSourceRequest } from "./[[path]].js";

const SESSION_COOKIE = "anytime_session";
const MANGATIME_BASE = "https://mangatime.org";
const TEAMX_BASE = "https://olympustaff.com";
const SOURCE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const source = String(url.searchParams.get("source") || "mangatime").toLowerCase();
  if (source === "3asq" || source === "starzmanga" || source === "xsano" || source === "mangalik") return handleSourceRequest(context);
  if (!env.DB) return json({ error: "D1_NOT_CONFIGURED", message: "قاعدة بيانات Anytime غير مربوطة بالموقع." }, 503);
  if (!(await getSession(request, env.DB))) return json({ error: "UNAUTHORIZED", message: "انتهت الجلسة. سجل دخولك مرة ثانية." }, 401);
  const page = safePage(url.searchParams.get("page"));

  try {
    await ensureSchema(env.DB);
    if (source === "teamx") {
      const payload = await teamXLatest(page);
      await rememberItems(env.DB, payload.items);
      return json(payload, 200, { "Cache-Control": "private, max-age=45" });
    }
    if (source !== "mangatime") return json({ error: "UNKNOWN_SOURCE", message: "المصدر غير معروف." }, 400);

    const result = await searchSeries(page);
    const items = await Promise.all((result?.results || []).map(toMangaTimeItem));
    await rememberItems(env.DB, items);
    return json({ items, hasMore: Boolean(result?.hasMore), page }, 200, { "Cache-Control": "private, max-age=45" });
  } catch (error) {
    console.error("Source latest error", error);
    return json({ error: "SOURCE_UPSTREAM", message: error?.message || "تعذر الوصول إلى المصدر الآن." }, 502);
  }
}

async function searchSeries(page) {
  // Optional tRPC inputs must be omitted, not serialized as null.
  const inputs = [
    { page, limit: 24, sortBy: "recent", sortOrder: "desc" },
    { page, limit: 24, sortBy: "updated", sortOrder: "desc" },
    { page, limit: 24, sortBy: "popularity", sortOrder: "desc" },
  ];
  let lastStatus = 0;
  for (const input of inputs) {
    const endpoint = new URL(`${MANGATIME_BASE}/api/trpc/search.searchSeries`);
    endpoint.searchParams.set("batch", "1");
    endpoint.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
    const response = await fetch(endpoint, {
      headers: sourceHeaders(MANGATIME_BASE, "application/json,text/plain,*/*"),
      cf: { cacheTtl: 30, cacheEverything: true },
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (first?.error) continue;
    const data = first?.result?.data?.json;
    if (data && Array.isArray(data.results)) return data;
  }
  throw new Error(`MangaTime رجع HTTP ${lastStatus || 400}.`);
}

async function toMangaTimeItem(row) {
  const sourceId = String(row.id);
  const type = String(row.type || "manga");
  const slug = String(row.slug || "");
  return {
    key: await makeSourceKey("mt", sourceId), source: "mangatime", sourceId, slug, type,
    url: `${MANGATIME_BASE}/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
    title: String(row.title || row.slug || "بدون عنوان"),
    cover: absoluteUrl(MANGATIME_BASE, row.coverUrl), description: "", status: "", genres: [],
  };
}

async function teamXLatest(page) {
  const target = `${TEAMX_BASE}/?page=${page}`;
  const response = await fetch(target, {
    headers: sourceHeaders(TEAMX_BASE, "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
    redirect: "follow", cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Team-X رجع HTTP ${response.status}.`);
  const html = await response.text();
  const marker = html.search(/class=["'][^"']*post-body[^"']*["']/i);
  const scoped = marker >= 0 ? html.slice(marker) : html;
  const items = [];
  const seen = new Set();
  const regex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(scoped)) && items.length < 24) {
    const href = absoluteUrl(TEAMX_BASE, match[2]);
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    const path = parsed.pathname.match(/^\/series\/([^/]+)\/?$/i);
    if (!path) continue;
    const slug = decodeURIComponent(path[1]);
    if (seen.has(slug)) continue;
    const inner = match[4];
    const title = cleanText((inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]) || (inner.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1]) || inner);
    if (!title) continue;
    const coverRaw = inner.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1] || "";
    seen.add(slug);
    items.push({ key: `tx:${safeSlugKey(slug)}`, source: "teamx", sourceId: slug, slug, type: "series", url: `${TEAMX_BASE}/series/${encodeURIComponent(slug)}`, title, cover: absoluteUrl(TEAMX_BASE, coverRaw), description: "", status: "", genres: [] });
  }
  return { items, hasMore: /<a[^>]+rel=["']next["']/i.test(html), page };
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS source_items (
    source_key TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
    slug TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL, cover_url TEXT NOT NULL DEFAULT '', description TEXT,
    status TEXT, genres_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL,
    first_seen_at INTEGER,
    UNIQUE(source, source_id)
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(source_items)").all();
  if (!(columns.results ?? []).some((column) => column.name === "first_seen_at")) {
    await db.prepare("ALTER TABLE source_items ADD COLUMN first_seen_at INTEGER").run();
  }
  await db.prepare("UPDATE source_items SET first_seen_at = updated_at WHERE first_seen_at IS NULL").run();
}

async function rememberItems(db, items) {
  if (!items.length) return;
  const now = Date.now();
  await db.batch(items.slice(0, 80).map((item) => db.prepare(`INSERT INTO source_items
    (source_key, source, source_id, slug, type, url, title, cover_url, description, status, genres_json, updated_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET source_id=excluded.source_id, slug=excluded.slug,
    type=excluded.type, url=excluded.url, title=excluded.title,
    cover_url=CASE WHEN excluded.cover_url <> '' THEN excluded.cover_url ELSE source_items.cover_url END,
    updated_at=excluded.updated_at,
    first_seen_at=COALESCE(source_items.first_seen_at, excluded.first_seen_at)`).bind(item.key, item.source, item.sourceId, item.slug, item.type, item.url, item.title, item.cover, null, null, "[]", now, now)));
}

function safePage(value) { const page = Number(value || 1); return Number.isInteger(page) && page > 0 && page <= 100 ? page : 1; }
function safeSlugKey(slug) { return String(slug).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "series"; }
function sourceHeaders(base, accept) { return { Accept: accept, "Accept-Language": "ar,en-US;q=0.9,en;q=0.8", Referer: `${base}/`, "User-Agent": SOURCE_UA }; }
function absoluteUrl(base, value) { if (!value) return ""; try { return new URL(String(value).trim().replaceAll(" ", "%20"), base).toString(); } catch { return ""; } }
function cleanText(value) { return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^غلاف\s+/i, "").trim(); }
function decodeEntities(value) { return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "); }

async function makeSourceKey(prefix, sourceId) {
  if (/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return `${prefix}:${sourceId}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceId));
  return `${prefix}:${bytesToBase64Url(new Uint8Array(digest)).slice(0, 24)}`;
}
async function getSession(request, db) { const token = getCookie(request, SESSION_COOKIE); if (!token) return null; const tokenHash = await sha256Base64Url(token); return db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1").bind(tokenHash, Date.now()).first(); }
function getCookie(request, name) { const cookie = request.headers.get("Cookie") || ""; for (const part of cookie.split(";")) { const [key, ...value] = part.trim().split("="); if (key === name) return value.join("="); } return null; }
async function sha256Base64Url(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return bytesToBase64Url(new Uint8Array(digest)); }
function bytesToBase64Url(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function json(body, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } }); }
