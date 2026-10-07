import type { SourceManga, SourceChapter } from "../types";

export interface AvailableChapterProgress {
  percent: number;
  estimated?: boolean;
  currentPosition: number;
  totalPositions: number;
  latestChapter: number | null;
}

function orderedAvailableChapters(chapters?: SourceChapter[]) {
  const unique = new Map<number, SourceChapter>();
  for (const chapter of chapters ?? []) {
    const number = Number(chapter.number);
    if (!Number.isFinite(number)) continue;
    if (!unique.has(number)) unique.set(number, chapter);
  }
  return [...unique.values()].sort(
    (a, b) => Number(a.number) - Number(b.number),
  );
}

export function availableChapterProgress(
  chapters: SourceChapter[] | undefined,
  highestReachedChapter: number | null,
): AvailableChapterProgress | null {
  if (highestReachedChapter == null) return null;
  const ordered = orderedAvailableChapters(chapters);
  if (!ordered.length) return null;

  const index = ordered.findIndex(
    (chapter) =>
      Math.abs(Number(chapter.number) - Number(highestReachedChapter)) <
      0.000001,
  );
  if (index < 0) return null;

  const latest = ordered.at(-1);
  return {
    percent: Math.max(0, Math.min(100, ((index + 1) / ordered.length) * 100)),
    currentPosition: index + 1,
    totalPositions: ordered.length,
    latestChapter: latest ? Number(latest.number) : null,
  };
}


// A partial archive cannot supply a reliable chapter position. Its latest
// chapter still provides an explicitly labelled estimate, including parts.
export function sourceChapterProgress(item: SourceManga, highest: number | null): AvailableChapterProgress | null {
  if (highest == null || !Number.isFinite(highest)) return null;
  if (item.chapterListComplete !== false) {
    const exact = availableChapterProgress(item.chapters, highest);
    if (exact) return exact;
  }
  const latest = Math.max(Number(item.latest) || 0, ...(item.chapters ?? []).map(chapter => Number(chapter.number)).filter(Number.isFinite));
  if (latest <= 0 || highest < 0 || highest > latest) return null;
  return {
    percent: Math.max(0, Math.min(100, highest / latest * 100)),
    currentPosition: highest,
    totalPositions: latest,
    latestChapter: latest,
    estimated: true,
  };
}
