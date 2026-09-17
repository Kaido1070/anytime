import mangaTimeEnglishTitles from "../data/mangatimeEnglishTitles.json";
import type { SourceManga } from "../types";

const ARABIC_RE = /[\u0600-\u06ff]/;
const titles = mangaTimeEnglishTitles as Record<string, string>;

export function sourceEnglishTitle(item: Pick<SourceManga, "source" | "slug" | "title">) {
  if (item.source !== "mangatime" || !ARABIC_RE.test(item.title)) return "";
  return String(titles[item.slug] ?? "").trim();
}

export function sourceDisplayTitle(item: Pick<SourceManga, "source" | "slug" | "title">) {
  const english = sourceEnglishTitle(item);
  return english ? `${item.title} (${english})` : item.title;
}
