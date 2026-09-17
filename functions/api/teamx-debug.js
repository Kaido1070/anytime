const TEAMX_BASE = "https://olympustaff.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequest(context) {
  const db = context.env?.DB;
  if (!db) return json({ error: "NO_DB" }, 503);
  const row = await db.prepare("SELECT source_key, slug, url, title FROM source_items WHERE source = 'teamx' AND title LIKE '%Long Way%Warrior%' LIMIT 1").first();
  if (!row) return json({ error: "ITEM_NOT_IN_DB" }, 404);

  const seriesUrl = row.url || `${TEAMX_BASE}/series/${row.slug}`;
  const seriesHtml = await getText(seriesUrl);
  const chapterUrl = findChapterUrl(seriesHtml, seriesUrl, "1");
  if (!chapterUrl) return json({ row, error: "CHAPTER_NOT_FOUND" }, 404);
  const html = await getText(chapterUrl);
  const marker = html.search(/<div\b[^>]*class=["'][^"']*\bimage_list\b[^"']*["'][^>]*>/i);
  if (marker < 0) return json({ row, chapterUrl, error: "IMAGE_LIST_NOT_FOUND" }, 404);
  const scoped = html.slice(marker, Math.min(html.length, marker + 500000));
  const canvases = [];
  const re = /<canvas\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(scoped)) && canvases.length < 12) {
    const attrs = m[1];
    canvases.push({
      width: attr(attrs, "width"),
      height: attr(attrs, "height"),
      style: attr(attrs, "style"),
      className: attr(attrs, "class"),
      src: attr(attrs, "data-src") || attr(attrs, "data-lazy-src"),
      raw: m[0].slice(0, 600),
    });
  }
  return json({ row, chapterUrl, canvasCount: canvases.length, canvases });
}

async function getText(url) {
  const response = await fetch(new URL(url, TEAMX_BASE), {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      Referer: `${TEAMX_BASE}/`,
      "User-Agent": UA,
    },
    redirect: "follow",
    cf: { cacheTtl: 0 },
  });
  if (!response.ok) throw new Error(`TeamX HTTP ${response.status}`);
  return response.text();
}

function findChapterUrl(html, seriesUrl, number) {
  const cardRe = /<div\b([^>]*)class=["'][^"']*chapter-card[^"']*["']([^>]*)>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = cardRe.exec(html))) {
    const attrs = `${match[1]} ${match[2]}`;
    if (attr(attrs, "data-number") !== number) continue;
    if (/class=["'][^"']*locked/i.test(match[3])) continue;
    const href = match[3].match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (href) return new URL(href, TEAMX_BASE).toString();
  }
  const basePath = new URL(seriesUrl, TEAMX_BASE).pathname.replace(/\/$/, "");
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["']/gi;
  while ((match = anchorRe.exec(html))) {
    const candidate = new URL(match[1], TEAMX_BASE);
    if (candidate.pathname.replace(/\/$/, "") === `${basePath}/${number}`) return candidate.toString();
  }
  return `${seriesUrl.replace(/\/$/, "")}/${number}`;
}

function attr(input, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(input).match(new RegExp(`(?:^|\\s)${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
