import { onRequest as handleSourceRequest } from "./[[path]].js";

const TEAMX_BASE = "https://olympustaff.com";
const SOURCE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
    const pages = parseTeamXCanvasPages(html);
    if (!pages.length) return response;

    payload.chapter.pages = pages;
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

export function parseTeamXCanvasPages(html) {
  const marker = String(html ?? "").search(
    /<div\b[^>]*class=["'][^"']*\bimage_list\b[^"']*["'][^>]*>/i,
  );
  if (marker < 0) return [];

  const source = String(html);
  const hardEnd = Math.min(source.length, marker + 2_500_000);
  const footer = source.slice(marker, hardEnd).search(/<footer\b/i);
  const end = footer >= 0 ? marker + footer : hardEnd;
  const scoped = source.slice(marker, end);

  const canvasPages = extractTagUrls(scoped, "canvas", ["data-src", "data-lazy-src"]);
  if (canvasPages.length) return uniqueAbsolute(canvasPages);

  const imagePages = extractTagUrls(scoped, "img", ["data-src", "data-lazy-src", "src"]);
  return uniqueAbsolute(imagePages).filter(
    (url) => !/logo|avatar|favicon|icon|profile|(?:^|[\/_-])ads?(?:[\/_-]|\.)|banner/i.test(url),
  );
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

function uniqueAbsolute(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || value.startsWith("data:")) continue;
    let absolute;
    try {
      absolute = new URL(value.replaceAll(" ", "%20"), TEAMX_BASE).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push(absolute);
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
