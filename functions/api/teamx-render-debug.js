const BASE = "https://olympustaff.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function onRequest() {
  try {
    const searchUrl = `${BASE}/search?keyword=${encodeURIComponent("The Long Way Of The Warrior")}`;
    const searchHtml = await text(searchUrl, `${BASE}/`);
    const seriesUrl = findSeries(searchHtml);
    if (!seriesUrl) return json({ error: "SERIES_NOT_FOUND" }, 404);

    const seriesHtml = await text(seriesUrl, `${BASE}/`);
    const chapterUrl = findChapter(seriesHtml, seriesUrl, "1") || `${seriesUrl.replace(/\/$/, "")}/1`;
    const chapterHtml = await text(chapterUrl, seriesUrl);
    const canvases = extractCanvases(chapterHtml).slice(0, 8);

    const inspected = [];
    for (const canvas of canvases) {
      const imageUrl = new URL(canvas.src, BASE).toString();
      const image = await fetch(imageUrl, {
        headers: headers(chapterUrl, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"),
        redirect: "follow",
        cf: { cacheTtl: 0 },
      });
      const bytes = image.ok ? new Uint8Array(await image.arrayBuffer()) : null;
      inspected.push({
        ...canvas,
        imageUrl,
        status: image.status,
        type: image.headers.get("content-type"),
        length: bytes?.byteLength ?? 0,
        intrinsic: bytes ? imageSize(bytes, image.headers.get("content-type") || "") : null,
      });
    }

    return json({ seriesUrl, chapterUrl, count: canvases.length, canvases: inspected });
  } catch (error) {
    return json({ error: "DEBUG_FAILED", message: String(error?.message || error) }, 500);
  }
}

async function text(url, referer) {
  const response = await fetch(url, {
    headers: headers(referer, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    redirect: "follow",
    cf: { cacheTtl: 0 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.text();
}

function headers(referer, accept) {
  return { Accept: accept, "Accept-Language": "ar,en-US;q=0.9,en;q=0.8", Referer: referer, "User-Agent": UA };
}

function findSeries(html) {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const title = strip(m[2]);
    if (/The Long Way Of The Warrior/i.test(title)) return new URL(href, BASE).toString();
  }
  return null;
}

function findChapter(html, seriesUrl, number) {
  const basePath = new URL(seriesUrl).pathname.replace(/\/$/, "");
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const u = new URL(href, BASE);
    if (u.pathname.replace(/\/$/, "") === `${basePath}/${number}`) return u.toString();
  }
  return null;
}

function extractCanvases(html) {
  const marker = html.search(/class=["'][^"']*image_list[^"']*["']/i);
  const scoped = marker >= 0 ? html.slice(marker, Math.min(html.length, marker + 1500000)) : html;
  const out = [];
  const re = /<canvas\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(scoped))) {
    const a = m[1];
    const src = attr(a, "data-src") || attr(a, "data-lazy-src");
    if (!src) continue;
    out.push({
      src,
      width: attr(a, "width"),
      height: attr(a, "height"),
      dataWidth: attr(a, "data-width"),
      dataHeight: attr(a, "data-height"),
      style: attr(a, "style"),
      className: attr(a, "class"),
    });
  }
  return out;
}

function attr(input, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(input).match(new RegExp(`(?:^|\\s)${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i"));
  return decode(m?.[1] ?? m?.[2] ?? m?.[3] ?? "") || null;
}

function strip(value) {
  return decode(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decode(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function imageSize(b, type) {
  try {
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { width: u32(b, 16), height: u32(b, 20), format: "png" };
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i += 1; continue; }
        const marker = b[i + 1];
        i += 2;
        if (marker === 0xd8 || marker === 0xd9) continue;
        const len = (b[i] << 8) | b[i + 1];
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return { width: (b[i+5] << 8) | b[i+6], height: (b[i+3] << 8) | b[i+4], format: "jpeg" };
        }
        if (len < 2) break;
        i += len;
      }
    }
    if (b.length >= 30 && String.fromCharCode(...b.slice(0,4)) === "RIFF" && String.fromCharCode(...b.slice(8,12)) === "WEBP") {
      const chunk = String.fromCharCode(...b.slice(12,16));
      if (chunk === "VP8X") {
        return { width: 1 + b[24] + (b[25]<<8) + (b[26]<<16), height: 1 + b[27] + (b[28]<<8) + (b[29]<<16), format: "webp-vp8x" };
      }
      if (chunk === "VP8L" && b[20] === 0x2f) {
        const bits = b[21] | (b[22]<<8) | (b[23]<<16) | (b[24]<<24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp-vp8l" };
      }
      if (chunk === "VP8 " && b.length >= 30) {
        return { width: (b[26] | (b[27]<<8)) & 0x3fff, height: (b[28] | (b[29]<<8)) & 0x3fff, format: "webp-vp8" };
      }
    }
  } catch {}
  return { format: type || "unknown" };
}

function u32(b, i) { return ((b[i]<<24) | (b[i+1]<<16) | (b[i+2]<<8) | b[i+3]) >>> 0; }

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
