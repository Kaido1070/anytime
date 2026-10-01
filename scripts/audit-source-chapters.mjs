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
const catalogDiagnostics = new Map();

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

function recordCatalogDiagnostic(source, value) {
  catalogDiagnostics.set(source, value);
}

async function catalogMangaTime() {
  const items = [];
  const seen = new Set();
  let exhausted = false;
  let pages = 0;

  for (let page = 1; page <= maxCatalogPages; page += 1) {
    pages = page;
    const payload = await __test.mangaTimeTrpc(
      "search.searchSeries",
      __test.mangaTimeSearchInput({ page, sortBy: "recent", query: null }),
    );
    const rows = Array.isArray(payload && payload.results) ? payload.results : [];
    if (!rows.length) {
      exhausted = true;
      break;
    }

    let newRows = 0;
    for (const row of rows) {
      if (!row || row.id == null) continue;
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      newRows += 1;
      items.push({
        source: "mangatime",
        sourceId: id,
        slug: String(row.slug || ""),
        title: String(row.title || row.slug || row.id),
      });
    }

    // The catalogue must end by returning no new identities. We deliberately
    // do not trust hasMore alone because the whole purpose of this audit is to
    // catch hidden/secondary pages.
    if (!newRows) {
      exhausted = true;
      break;
    }

    await sleep(delayMs);
  }

  recordCatalogDiagnostic("mangatime", {
    pages,
    exhausted,
    stopReason: exhausted ? "empty-or-repeated-page" : "page-cap",
  });
  return limited(items);
}

async function catalogMadara(source) {
  const base = BASES[source];
  const parser =
    source === "3asq"
      ? __test.asqItemsFromHtml
      : source === "starzmanga"
        ? __test.starzItemsFromHtml
        : __test.mangalikItemsFromHtml;

  const items = [];
  const seen = new Set();
  let exhausted = false;
  let pages = 0;
  let stopReason = "page-cap";
  let errorMessage = null;
  let transportBlocked = false;

  for (let page = 1; page <= maxCatalogPages; page += 1) {
    pages = page;
    const url = base + "/manga/page/" + page + "/?m_orderby=latest";

    let html;
    try {
      html = await fetchText(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (page > 1 && /HTTP 404\b/.test(message)) {
        exhausted = true;
        stopReason = "404-end";
        break;
      }
      if (page > 1) {
        errorMessage = message;
        transportBlocked = /HTTP (?:403|429|503)\b/.test(message);
        stopReason = transportBlocked ? "transport-blocked" : "page-error";
        break;
      }
      throw error;
    }

    const rows = parser(html);
    if (!rows.length) {
      exhausted = true;
      stopReason = "empty-page";
      break;
    }

    let newRows = 0;
    for (const item of rows) {
      const identity = item.url || item.slug;
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      newRows += 1;
      items.push(item);
    }

    // Always probe the next catalogue page even if the rendered pagination
    // controls are absent. Stop only when the source returns no new series.
    if (!newRows) {
      exhausted = true;
      stopReason = "repeated-page";
      break;
    }

    await sleep(delayMs);
  }

  recordCatalogDiagnostic(source, {
    pages,
    exhausted,
    stopReason,
    error: errorMessage,
    transportBlocked,
  });
  return limited(items);
}

async function catalogXsano() {
  const entries = [];
  const seenEntries = new Set();
  let start = 1;
  let total = Number.POSITIVE_INFINITY;
  let pages = 0;
  let exhausted = false;

  while (start <= total && pages < maxCatalogPages) {
    pages += 1;
    const url = new URL("/feeds/posts/default/-/Series", BASES.xsano);
    url.searchParams.set("alt", "json");
    url.searchParams.set("orderby", "published");
    url.searchParams.set("max-results", "500");
    url.searchParams.set("start-index", String(start));

    const payload = await fetchJson(url.toString());
    const feed = (payload && payload.feed) || {};
    const pageEntries = Array.isArray(feed.entry) ? feed.entry : [];
    const reportedTotal = Number(
      feed["openSearch$totalResults"] &&
      feed["openSearch$totalResults"]["$t"],
    );
    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;

    if (!pageEntries.length) {
      exhausted = true;
      break;
    }

    let newRows = 0;
    for (const entry of pageEntries) {
      const identity =
        entry && entry.id && entry.id["$t"]
          ? String(entry.id["$t"])
          : JSON.stringify(entry && entry.link || entry && entry.title || "");
      if (!identity || seenEntries.has(identity)) continue;
      seenEntries.add(identity);
      entries.push(entry);
      newRows += 1;
    }

    if (!newRows) {
      exhausted = true;
      break;
    }

    start += pageEntries.length;
    if (Number.isFinite(total) && start > total) {
      exhausted = true;
      break;
    }
    await sleep(delayMs);
  }

  const items = [];
  for (const entry of entries) {
    const item = await __test.xsanoSeriesItemFromEntry(entry);
    if (item) items.push(item);
  }

  recordCatalogDiagnostic("xsano", {
    pages,
    exhausted,
    reportedTotal: Number.isFinite(total) ? total : null,
    stopReason: exhausted ? "source-end" : "page-cap",
  });
  return limited(uniqueBy(items, (item) => item.url || item.sourceId));
}

async function catalogAzora() {
  const items = [];
  const seen = new Set();
  let exhausted = false;
  let pages = 0;
  let stopReason = "page-cap";
  let errorMessage = null;
  let transportBlocked = false;

  for (let page = 1; page <= maxCatalogPages; page += 1) {
    pages = page;
    const url = new URL("/series/", BASES.azora);
    if (page > 1) url.searchParams.set("page", String(page));

    let html;
    try {
      html = await fetchText(url.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (page > 1 && /HTTP 404\b/.test(message)) {
        exhausted = true;
        stopReason = "404-end";
        break;
      }
      if (page > 1) {
        errorMessage = message;
        transportBlocked = /HTTP (?:403|429|503)\b/.test(message);
        stopReason = transportBlocked ? "transport-blocked" : "page-error";
        break;
      }
      throw error;
    }

    const rows = __test.azoraItemsFromHtml(html);
    if (!rows.length) {
      exhausted = true;
      stopReason = "empty-page";
      break;
    }

    let newRows = 0;
    for (const item of rows) {
      const identity = item.url || item.slug;
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      newRows += 1;
      items.push(item);
    }

    if (!newRows) {
      exhausted = true;
      stopReason = "repeated-page";
      break;
    }

    await sleep(delayMs);
  }

  recordCatalogDiagnostic("azora", {
    pages,
    exhausted,
    stopReason,
    error: errorMessage,
    transportBlocked,
  });
  return limited(items);
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
  let resolved = __test.mergeChapterLists(
    visible,
    parse(completeHtml, item.url),
  );

  // 3asq and Starz also expose WordPress admin-ajax chapter archives on some
  // themes. Compare that independent route too; a "full" list is the union of
  // every source-owned chapter archive we can reach.
  let alternateCount = null;
  if (source === "3asq") {
    const postId = __test.asqPostId(firstHtml);
    if (postId) {
      const ajaxHtml = await __test.asqFetchChapters(postId, item.url).catch(() => "");
      const alternate = parse(ajaxHtml, item.url);
      alternateCount = alternate.length;
      resolved = __test.mergeChapterLists(resolved, alternate);
    }
  } else if (source === "starzmanga") {
    const postId = __test.starzPostId(firstHtml);
    if (postId) {
      const ajaxHtml = await __test.starzFetchChapters(postId).catch(() => "");
      const alternate = parse(ajaxHtml, item.url);
      alternateCount = alternate.length;
      resolved = __test.mergeChapterLists(resolved, alternate);
    }
  }

  return {
    visible: visible.length,
    resolved: resolved.length,
    declared: null,
    complete: null,
    recovered: Math.max(0, resolved.length - visible.length),
    alternateCount,
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
  console.log("\n=== " + source + " catalog ===");

  let items;
  try {
    items = await catalog(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transportBlocked = /HTTP (?:403|429|503)\b/.test(message);
    console.log(
      source + ": catalog unavailable (" +
      (transportBlocked ? "transport-blocked" : "catalog-error") +
      "): " + message,
    );
    return {
      rows: [],
      transportBlocked,
      catalogError: message,
    };
  }

  const catalogDiagnostic = catalogDiagnostics.get(source) || {
    pages: null,
    exhausted: null,
    stopReason: "unknown",
  };
  console.log(
    source + ": discovered " + items.length +
    " series; catalogPages=" + catalogDiagnostic.pages +
    "; exhausted=" + catalogDiagnostic.exhausted,
  );

  const rows = [];
  const blockedRetries = [];
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
      const transportBlocked = /HTTP (?:403|429|503)\b/.test(message);
      rows.push({
        source,
        title: label,
        slug: item.slug || "",
        url: item.url || "",
        issue: !transportBlocked,
        transportBlocked,
        error: message,
      });
      if (transportBlocked) {
        blockedRetries.push({ rowIndex: rows.length - 1, item, label });
      }
      console.log(
        "[" + (index + 1) + "/" + items.length + "] " +
        (transportBlocked ? "BLOCKED " : "ERROR ") +
        label + ": " + message,
      );
    }

    await sleep(delayMs);
  }

  if (blockedRetries.length) {
    console.log(
      source + ": retrying " + blockedRetries.length +
      " transport-blocked series after cooldown",
    );
    await sleep(Math.max(10_000, delayMs * 4));

    for (const retry of blockedRetries) {
      try {
        const result = await auditItem(source, retry.item);
        const issue =
          result.complete === false ||
          (result.declared != null && result.resolved < result.declared);

        rows[retry.rowIndex] = {
          source,
          title: retry.label,
          slug: retry.item.slug || "",
          url: retry.item.url || "",
          ...result,
          issue,
          transportBlocked: false,
        };

        console.log(
          "RETRY " + (issue ? "FAIL " : "OK ") + retry.label +
          " resolved=" + result.resolved +
          " declared=" + (result.declared == null ? "?" : result.declared),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transportBlocked = /HTTP (?:403|429|503)\b/.test(message);
        rows[retry.rowIndex] = {
          ...rows[retry.rowIndex],
          issue: !transportBlocked,
          transportBlocked,
          error: message,
        };
        console.log(
          "RETRY " + (transportBlocked ? "BLOCKED " : "ERROR ") +
          retry.label + ": " + message,
        );
      }

      await sleep(Math.max(delayMs, 1500));
    }
  }

  return {
    rows,
    transportBlocked: false,
    catalogError: null,
    catalogDiagnostic,
  };
}

await mkdir("audit-results", { recursive: true });

let issueCount = 0;
let transportBlockedCount = 0;
let catalogIncompleteCount = 0;
let auditedCount = 0;

for (const source of selectedSources) {
  const result = await auditSource(source);
  const rows = result.rows;
  const sourceIssues = rows.filter((row) => row.issue).length;
  const rowTransportBlocks = rows.filter((row) => row.transportBlocked).length;
  auditedCount += rows.length;
  issueCount += sourceIssues;
  transportBlockedCount += (result.transportBlocked ? 1 : 0) + rowTransportBlocks;
  if (result.catalogDiagnostic && result.catalogDiagnostic.exhausted === false) {
    catalogIncompleteCount += 1;
  }

  await writeFile(
    "audit-results/" + source + ".json",
    JSON.stringify(
      {
        source,
        auditedAt: new Date().toISOString(),
        catalog: result.catalogDiagnostic || null,
        status: result.transportBlocked
          ? "transport-blocked"
          : result.catalogError
            ? "catalog-error"
            : sourceIssues
              ? "chapter-issues"
              : rowTransportBlocks
                ? "partial-transport-block"
                : "ok",
        seriesCount: rows.length,
        issueCount: sourceIssues,
        transportBlocked: result.transportBlocked,
        transportBlockedRows: rowTransportBlocks,
        catalogError: result.catalogError,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
}

console.log(
  "\nAudited " + auditedCount +
  " series; chapterIssues=" + issueCount +
  "; transportBlocked=" + transportBlockedCount +
  "; catalogIncomplete=" + catalogIncompleteCount,
);
if ((issueCount || catalogIncompleteCount) && failOnIssues) process.exitCode = 1;
