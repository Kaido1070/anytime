type Chapter = { number: number; title?: string; url?: string };

export function readerChapterWindow<T extends Chapter>(chapters: T[], number: number, chapterUrl?: string | null, baseUrl = "https://wany.site") {
  const normalize = (value?: string | null) => {
    if (!value) return "";
    try { const url = new URL(value, baseUrl); url.hash = ""; return url.toString().replace(/\/$/, ""); }
    catch { return value; }
  };
  const ordered = [...chapters].filter((entry) => Number.isFinite(Number(entry.number)))
    .sort((a, b) => Number(a.number) - Number(b.number) || String(a.url || "").localeCompare(String(b.url || "")));
  const exactUrl = normalize(chapterUrl);
  let index = exactUrl ? ordered.findIndex((entry) => normalize(entry.url) === exactUrl) : -1;
  if (index < 0) index = ordered.findIndex((entry) => Number(entry.number) === number);
  if (index < 0) {
    // A missing current row must remain selected, never default to the latest.
    return { options: [{ number, title: `الفصل ${number}`, url: chapterUrl || undefined }], selectedIndex: 0, previous: undefined, next: undefined };
  }
  const start = Math.max(0, index - 5);
  return {
    options: ordered.slice(start, index + 31),
    selectedIndex: index - start,
    previous: ordered[index - 1],
    next: ordered[index + 1],
  };
}
