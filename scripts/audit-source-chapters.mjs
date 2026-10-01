import { mkdir, writeFile } from "node:fs/promises";
import { __test } from "../functions/api/source/[[path]].js";

const SOURCES = ["mangatime", "3asq", "starzmanga", "xsano", "mangalik", "azora"];
const BASES = {
  "3asq": "https://3asq.online",
  starzmanga: "https://starzmanga.com",
  xsano: "https://www.xsano-manga.com",
  mangalik: "https://mangalik.net",
  azora: "https://azorafly.com",
};

const requested = String(process.env.AUDIT_SOURCE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedSources = requested.length ? requested : SOURCES;
const maxItems = Number(process.env.AUDIT_MAX_ITEMS || 0);
const delayMs = Math.max(0, Number(process.env.AUDIT_DELAY_MS || 350));
const maxCatalogPages = Math.max(1, Number(process.env.AUDIT_CATALOG_MAX_PAGES || 250));
const failOnIssues = process.env.AUDIT_FAIL_ON_ISSUES !== "0";

for (const source of selectedSources) {
  if (!SOURCES.includes(source)) throw new Error("Unsupported audit source: " + source);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSource(url, accept) {
  const parsed = new URL(url);
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: __test.sourceHeaders(parsed.origin, accept),
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) return response;

      lastError = new Error("HTTP " + response.status + " for " + url);
      if (response.status !== 429 && response.status !== 503) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }

    await sleep(1500 * (attempt + 1));
  }

  throw lastError || new Error("Source request failed for " + url);
}

async function fetchText(url) {
  const response = await fetchSource(
    url,
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  );
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchSource(url, "application/json,text/plain,*/*");
  return response.json();
}

function limited(items) {
  return maxItems > 0 ? items.slice(0, maxItems) : items;
}

function uniqueBy(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function catalogMangaTime() {
  const items = [];
  for (let page = 1; page <= maxCatalogPages; page += 1) {
    const payload = await __test.mangaTimeTrpc(
      "search.searchSeries",
      __test.mangaTimeSearchInput({ page, sortBy: "recent", query: null }),
    );
    const rows = Array.isArray(payload && payload.results) ? payload.results : [];
    for (const row of rows) {
      if (row && row.id != null) {
        items.push({
          source: "mangatime",
          sourceId: String(row.id),
          slug: String(row.slug || ""),
          title: String(row.title || row.slug || row.id),
        });
      }
    }
    if (!(payload && payload.hasMore) || !rows.length) break;
    await sleep(delayMs);
  }
  return limited(uniqueBy(items, (item) => item.sourceId));
}

async function catalogMadara(source) {
  const base = BASES[source];
  const parser =
    source === "3asq"
      ? __test.asqItemsFromHtml
      : source === "starzmanga"
        ? __test.starzItemsFromHtml
        : __test.mangalikItemsFromHtml;
  const hasNext =
    source === "3asq"
      ? __test.asqHasNext
      : source === "starzmanga"
        ? __test.starzHasNext
        : __test.mangalikHasNext;

  const items = [];
  for (let page = 1; page <= maxCatalogPages; page += 1) {
    const url = base + "/manga/page/" + page + "/?m_orderby=latest";
    const html = await fetchText(url);
    items.push(...parser(html));
    if (!hasNext(html)) break;
    await sleep(delayMs);
  }
  return limited(uniqueBy(items, (item) => item.url || item.slug));
}

async function catalogXsano() {
  const entries = [];
  let start = 1;
  let total = Number.POSITIVE_INFINITY;

  while (start <= total && start <= maxCatalogPages * 500) {
    const url = new URL("/feeds/posts/default/-/Series", BASES.xsano);
    url.searchParams.set("alt", "json");
    url.searchParams.set("orderby", "published");
    url.searchParams.set("max-results", "500");
    url.searchParams.set("start-index", String(start));

    const payload = await fetchJson(url.toString());
    const feed = (payload && payload.feed) || {};
    const pageEntries = Array.isArray(feed.entry) ? feed.entry : [];
    const reportedTotal = Number(feed["openSearch$totalResults"] && feed["openSearch$totalResults"]["$t"]);
    if (Number.isFinite(reportedTotal)) total = reportedTotal;
    if (!pageEntries.length) break;

    entries.push(...pageEntries);
    start += pageEntries.length;
    await sleep(delayMs);
  }

  const items = [];
  for (const entry of entries) {
    const item = await __test.xsanoSeriesItemFromEntry(entry);
    if (item) items.push(item);
  }
  return limited(uniqueBy(items, (item) => item.url || item.sourceId));
}

async function catalogAzora() {
  const items = [];
  for (let page = 1; page <= maxCatalogPages; page += 1) {
    const url = new URL("/series/", BASES.azora);
    if (page > 1) url.searchParams.set("page", String(page));
    const html = await fetchText(url.toString());
    items.push(...__test.azoraItemsFromHtml(html));
    if (!__test.azoraHasNext(html, page)) break;
    await sleep(delayMs);
  }
  return limited(uniqueBy(items, (item) => item.url || item.slug));
}

async function catalog(source) {
  if (source === "mangatime") return catalogMangaTime();
  if (source === "xsano") return catalogXsano();
  if (source === "azora") return catalogAzora();
  return catalogMadara(source);
}

async function auditMangaTime(item) {
  const first = await __test.mangaTimeTrpc("content.getChapters", {
    seriesId: item.sourceId,
    limit: -1,
  });
  const visible = __test.mangaTimeChaptersFromPayload(first);
  const declared = __test.mangaTimeChapterTotal(first);
  const chapters = await __test.mangaTimeAllChapters(item.sourceId);

  return {
    visible: visible.length,
    resolved: chapters.length,
    declared,
    complete: declared == null ? null : chapters.length >= declared,
  };
}

async function auditMadara(source, item) {
  const parse =
    source === "3asq"
      ? __test.parseAsqChapters
      : source === "starzmanga"
        ? __test.parseStarzChapters
        : __test.parseMangalikChapters;
  const completeFetch =
    source === "3asq"
      ? __test.asqFetchSeriesChapters
      : source === "starzmanga"
        ? __test.starzFetchSeriesChapters
        : __test.mangalikFetchSeriesChapters;

  const firstHtml = await fetchText(item.url);
  const visible = parse(firstHtml, item.url);
  const completeHtml = await completeFetch(item.url);
  const resolved = __test.mergeChapterLists(visible, parse(completeHtml, item.url));

  return {
    visible: visible.length,
    resolved: resolved.length,
    declared: null,
    complete: true,
    recovered: Math.max(0, resolved.length - visible.length),
  };
}

async function auditXsano(item) {
  const html = await fetchText(item.url);
  const feedUrl = __test.xsanoChapterFeedUrl(html);

  const firstUrl = new URL(feedUrl);
  firstUrl.searchParams.set("alt", "json");
  firstUrl.searchParams.set("start-index", "1");
  firstUrl.searchParams.set("max-results", "1");
  const first = await fetchJson(firstUrl.toString());
  const declared = Number(
    first &&
    first.feed &&
    first.feed["openSearch$totalResults"] &&
    first.feed["openSearch$totalResults"]["$t"]
  );

  const chapters = await __test.xsanoFetchChapters(feedUrl);
  return {
    visible: Number.isFinite(declared) ? Math.min(1, declared) : null,
    resolved: chapters.length,
    declared: Number.isFinite(declared) ? declared : null,
    complete: Number.isFinite(declared) ? chapters.length >= declared : null,
  };
}

async function auditAzora(item) {
  const html = await fetchText(item.url);
  const visible = __test.parseAzoraChapters(html, item.url);
  const result = await __test.azoraCompleteChapterList(html, item.url);
  return {
    visible: visible.length,
    resolved: result.chapters.length,
    declared: result.declaredCount,
    complete: result.complete,
    recovered: Math.max(0, result.chapters.length - visible.length),
  };
}

async function auditItem(source, item) {
  if (source === "mangatime") return auditMangaTime(item);
  if (source === "xsano") return auditXsano(item);
  if (source === "azora") return auditAzora(item);
  return auditMadara(source, item);
}

async function auditSource(source) {
  console.log("\\n=== " + source + " catalog ===");
  const items = await catalog(source);
  console.log(source + ": discovered " + items.length + " series");

  const rows = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const label = item.title || item.slug || item.sourceId || ("#" + (index + 1));

    try {
      const result = await auditItem(source, item);
      const issue =
        result.complete === false ||
        (result.declared != null && result.resolved < result.declared);

      rows.push({
        source,
        title: label,
        slug: item.slug || "",
        url: item.url || "",
        ...result,
        issue,
      });

      console.log(
        "[" + (index + 1) + "/" + items.length + "] " +
        (issue ? "FAIL " : "OK ") +
        label +
        " visible=" + (result.visible == null ? "?" : result.visible) +
        " resolved=" + result.resolved +
        " declared=" + (result.declared == null ? "?" : result.declared),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        source,
        title: label,
        slug: item.slug || "",
        url: item.url || "",
        issue: true,
        error: message,
      });
      console.log("[" + (index + 1) + "/" + items.length + "] ERROR " + label + ": " + message);
    }

    await sleep(delayMs);
  }

  return rows;
}

await mkdir("audit-results", { recursive: true });

let issueCount = 0;
let auditedCount = 0;

for (const source of selectedSources) {
  const rows = await auditSource(source);
  const sourceIssues = rows.filter((row) => row.issue).length;
  auditedCount += rows.length;
  issueCount += sourceIssues;

  await writeFile(
    "audit-results/" + source + ".json",
    JSON.stringify(
      {
        source,
        auditedAt: new Date().toISOString(),
        seriesCount: rows.length,
        issueCount: sourceIssues,
        rows,
      },
      null,
      2,
    ) + "\\n",
  );
}

console.log("\\nAudited " + auditedCount + " series; issues=" + issueCount);
if (issueCount && failOnIssues) process.exitCode = 1;
