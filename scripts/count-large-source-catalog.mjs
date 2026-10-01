import { __test } from "../functions/api/source/[[path]].js";

const source = String(process.env.COUNT_SOURCE || "").trim();
const delayMs = Math.max(0, Number(process.env.COUNT_DELAY_MS || 300));
const maxPages = Math.max(1, Number(process.env.COUNT_MAX_PAGES || 500));

if (source !== "mangatime" && source !== "azora") {
  throw new Error("COUNT_SOURCE must be mangatime or azora");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const parsed = new URL(url);
      const response = await fetch(url, {
        headers: __test.sourceHeaders(
          parsed.origin,
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ),
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return response.text();
      lastError = new Error("HTTP " + response.status + " for " + url);
      if (![429, 503].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }
    await sleep(1200 * (attempt + 1));
  }
  throw lastError || new Error("request failed");
}

if (source === "mangatime") {
  let totalSeries = 0;
  let lastPage = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await __test.mangaTimeTrpc(
      "search.searchSeries",
      __test.mangaTimeSearchInput({ page, sortBy: "recent", query: null }),
    );
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    totalSeries += rows.length;
    lastPage = page;

    console.log(
      "CATALOG_PAGE source=mangatime page=" + page +
      " items=" + rows.length +
      " hasMore=" + Boolean(payload?.hasMore),
    );

    if (!payload?.hasMore || !rows.length) break;
    await sleep(delayMs);
  }

  console.log(
    "CATALOG_TOTAL source=mangatime pages=" + lastPage +
    " series=" + totalSeries,
  );
} else {
  let totalSeries = 0;
  let lastPage = 0;
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("/series/", "https://azorafly.com");
    if (page > 1) url.searchParams.set("page", String(page));
    const html = await fetchText(url.toString());
    const items = __test.azoraItemsFromHtml(html);

    let added = 0;
    for (const item of items) {
      const identity = item.url || item.slug || item.key;
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      added += 1;
    }

    totalSeries = seen.size;
    lastPage = page;
    const hasMore = __test.azoraHasNext(html, page);

    console.log(
      "CATALOG_PAGE source=azora page=" + page +
      " items=" + items.length +
      " new=" + added +
      " total=" + totalSeries +
      " hasMore=" + hasMore,
    );

    if (!hasMore || !items.length || added === 0) break;
    await sleep(delayMs);
  }

  console.log(
    "CATALOG_TOTAL source=azora pages=" + lastPage +
    " series=" + totalSeries,
  );
}
