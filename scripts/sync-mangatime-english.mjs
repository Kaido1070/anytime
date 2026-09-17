import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = "https://mangatime.org";
const OUTPUT = "src/data/mangatimeEnglishTitles.json";
const REPORT = "data/mangatime-title-report.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36";
const ARABIC_RE = /[\u0600-\u06ff]/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let googleDisabled = false;
let anilistLastCall = 0;

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleCaseSlug(slug) {
  const small = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
  const words = decodeURIComponent(String(slug ?? ""))
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (/^[ivxlcdm]+$/i.test(word) || /^[a-z]{1,4}\d+$/i.test(word)) return word.toUpperCase();
      if (index > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    if (ratio >= 0.72) return 0.92 + ratio * 0.08;
  }
  const max = Math.max(left.length, right.length);
  return 1 - levenshtein(left, right) / max;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function trpc(endpoint, input, meta) {
  const url = new URL(`${BASE}/api/trpc/${endpoint}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({
    "0": {
      json: input,
      ...(meta ? { meta } : {}),
    },
  }));
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      Referer: `${BASE}/`,
      "User-Agent": UA,
      "X-MT-Platform": "web",
      "X-MT-UIMode": "standard",
    },
  }, 20000);
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`);
  const payload = await response.json();
  const first = Array.isArray(payload) ? payload[0] : null;
  if (first?.error) throw new Error(first.error?.json?.message || first.error?.message || `${endpoint} API error`);
  return first?.result?.data?.json;
}

const undefinedMeta = {
  values: {
    query: ["undefined"],
    "filters.status": ["undefined"],
    "filters.rating.min": ["undefined"],
    "filters.rating.max": ["undefined"],
    "filters.yearRange.from": ["undefined"],
    "filters.yearRange.to": ["undefined"],
    "filters.chapterCount.min": ["undefined"],
    "filters.chapterCount.max": ["undefined"],
    "filters.isColored": ["undefined"],
    "filters.isCompleted": ["undefined"],
    "filters.hasAdaptation": ["undefined"],
    "filters.genres": ["undefined"],
    "filters.type": ["undefined"],
  },
  v: 1,
};

async function fetchCatalogPage(page) {
  const attempts = [
    () => trpc("search.searchSeries", { page, limit: 100 }, undefinedMeta),
    () => trpc("search.searchSeries", { page, limit: 100, sortBy: "popularity", sortOrder: "desc" }),
    () => trpc("search.searchSeries", { page, limit: 24, sortBy: "popularity", sortOrder: "desc" }),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && Array.isArray(result.results)) return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("MangaTime catalog request failed");
}

async function fetchCatalog() {
  const map = new Map();
  let previousSize = 0;
  for (let page = 1; page <= 80; page += 1) {
    const result = await fetchCatalogPage(page);
    const rows = result?.results ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const id = String(row?.id ?? row?.slug ?? "");
      if (id) map.set(id, row);
    }
    console.log(`MangaTime page ${page}: ${rows.length} rows, ${map.size} unique`);
    if (map.size === previousSize) break;
    previousSize = map.size;
    if (result?.hasMore === false) break;
    await sleep(120);
  }
  return [...map.values()];
}

function englishTitlesFromMangaDexAttributes(attributes) {
  const values = [];
  if (attributes?.title?.en) values.push(attributes.title.en);
  for (const alt of attributes?.altTitles ?? []) {
    if (alt?.en) values.push(alt.en);
  }
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

async function mangaDexCandidate(candidate) {
  try {
    const url = new URL("https://api.mangadex.org/manga");
    url.searchParams.set("title", candidate);
    url.searchParams.set("limit", "5");
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json", "User-Agent": UA } }, 12000);
    if (!response.ok) return null;
    const payload = await response.json();
    let best = null;
    for (const item of payload?.data ?? []) {
      const titles = englishTitlesFromMangaDexAttributes(item?.attributes);
      for (const title of titles) {
        const score = similarity(candidate, title);
        if (!best || score > best.score) best = { title, score };
      }
    }
    return best;
  } catch {
    return null;
  }
}

async function aniListCandidate(candidate) {
  const elapsed = Date.now() - anilistLastCall;
  if (elapsed < 850) await sleep(850 - elapsed);
  anilistLastCall = Date.now();
  try {
    const query = `query ($search: String) { Media(search: $search, type: MANGA) { title { english romaji } synonyms } }`;
    const response = await fetchWithTimeout("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({ query, variables: { search: candidate } }),
    }, 12000);
    if (!response.ok) return null;
    const media = (await response.json())?.data?.Media;
    if (!media) return null;
    const options = [media.title?.english, media.title?.romaji, ...(media.synonyms ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    let best = null;
    for (const title of options) {
      const score = similarity(candidate, title);
      if (!best || score > best.score) best = { title, score, english: media.title?.english || "" };
    }
    if (!best) return null;
    return { title: String(media.title?.english || best.title), score: Math.max(best.score, similarity(candidate, media.title?.english || "")) };
  } catch {
    return null;
  }
}

async function googleConfirms(title) {
  if (googleDisabled) return null;
  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("hl", "en");
    url.searchParams.set("num", "7");
    url.searchParams.set("q", `\"${title}\" manga OR manhwa OR webtoon`);
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": UA,
      },
    }, 12000);
    if (response.status === 403 || response.status === 429) {
      googleDisabled = true;
      return null;
    }
    if (!response.ok) return null;
    const html = await response.text();
    if (/unusual traffic|our systems have detected|captcha/i.test(html)) {
      googleDisabled = true;
      return null;
    }
    const text = normalize(stripHtml(html));
    const needle = normalize(title);
    return Boolean(needle && text.includes(needle) && /\b(manga|manhwa|webtoon|comic)\b/.test(text));
  } catch {
    return null;
  }
}

async function verifyEnglish(row) {
  const slug = String(row?.slug ?? "").trim();
  if (!slug) return { english: "", method: "missing-slug", candidate: "" };
  const candidate = titleCaseSlug(slug);
  if (!candidate) return { english: "", method: "missing-candidate", candidate };

  const md = await mangaDexCandidate(candidate);
  if (md?.score >= 0.9) {
    const google = await googleConfirms(md.title);
    return {
      english: md.title,
      method: google === true ? "MangaDex+Google" : "MangaDex",
      candidate,
      confidence: md.score,
    };
  }

  const googleCandidate = await googleConfirms(candidate);
  if (googleCandidate === true) {
    return { english: candidate, method: "Google", candidate, confidence: 0.9 };
  }

  const ani = await aniListCandidate(candidate);
  if (ani?.score >= 0.9) {
    const google = await googleConfirms(ani.title);
    return {
      english: ani.title,
      method: google === true ? "AniList+Google" : "AniList",
      candidate,
      confidence: ani.score,
    };
  }

  if (md?.score >= 0.82 && ani?.score >= 0.82 && similarity(md.title, ani.title) >= 0.78) {
    const chosen = ani.title || md.title;
    return { english: chosen, method: "MangaDex+AniList", candidate, confidence: Math.min(md.score, ani.score) };
  }

  return {
    english: "",
    method: "unresolved",
    candidate,
    confidence: Math.max(md?.score ?? 0, ani?.score ?? 0),
    mangaDex: md?.title ?? "",
    aniList: ani?.title ?? "",
  };
}

async function loadExistingMap() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const catalog = await fetchCatalog();
  const arabic = catalog.filter((row) => ARABIC_RE.test(String(row?.title ?? "")));
  const mapping = await loadExistingMap();
  const report = [];

  console.log(`Catalog: ${catalog.length} total, ${arabic.length} Arabic titles`);

  for (let index = 0; index < arabic.length; index += 1) {
    const row = arabic[index];
    const slug = String(row?.slug ?? "").trim();
    const arabicTitle = String(row?.title ?? "").trim();
    if (!slug || !arabicTitle) continue;

    if (mapping[slug]) {
      report.push({ slug, arabic: arabicTitle, english: mapping[slug], method: "existing" });
      continue;
    }

    const result = await verifyEnglish(row);
    if (result.english) mapping[slug] = result.english;
    report.push({ slug, arabic: arabicTitle, ...result });
    console.log(`[${index + 1}/${arabic.length}] ${arabicTitle} -> ${result.english || "UNRESOLVED"} (${result.method})`);
    await sleep(180);
  }

  const sortedMapping = Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b)));
  const unresolved = report.filter((entry) => !entry.english);

  await mkdir("src/data", { recursive: true });
  await mkdir("data", { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(sortedMapping, null, 2)}\n`, "utf8");
  await writeFile(REPORT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalCatalog: catalog.length,
    arabicTitles: arabic.length,
    verifiedTitles: report.length - unresolved.length,
    unresolvedTitles: unresolved.length,
    googleAvailableAtEnd: !googleDisabled,
    items: report,
  }, null, 2)}\n`, "utf8");

  console.log(`Verified ${report.length - unresolved.length}/${report.length}; unresolved ${unresolved.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
