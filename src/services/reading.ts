import type { LibraryEntry } from "../types";

export function mergeLibraryRead(
  current: LibraryEntry | undefined,
  mangaId: string,
  chapter: number,
  readAt: number,
): LibraryEntry {
  const previousHighest = current?.highestReachedChapter;
  return {
    mangaId,
    status: current?.status === "planned" || !current ? "reading" : current.status,
    addedAt: current?.addedAt ?? readAt,
    updatedAt: Math.max(current?.updatedAt ?? 0, readAt),
    lastReadAt: readAt,
    lastReadChapter: chapter,
    highestReachedChapter:
      previousHighest == null ? chapter : Math.max(previousHighest, chapter),
  };
}

export function getContinueChapter(
  chapters: Array<{ number: number }> | undefined,
  highestReachedChapter: number,
  highestChapterCompleted: boolean,
) {
  if (!highestChapterCompleted) return highestReachedChapter;
  const next = (chapters ?? [])
    .map((chapter) => Number(chapter.number))
    .filter((number) => Number.isFinite(number) && number > highestReachedChapter)
    .sort((a, b) => a - b)[0];
  return next ?? highestReachedChapter;
}

/**
 * Resume the chapter most recently opened, not the highest ever reached.
 * The chapter archive may be paginated or incomplete, so never substitute
 * its first available chapter for an already recorded reading position.
 */
export function getResumeChapter(
  entry: Pick<LibraryEntry, "lastReadChapter" | "highestReachedChapter"> | undefined,
  chapters: Array<{ number: number }> | undefined,
  highestChapterCompleted: boolean,
): number | null {
  const lastRead = entry?.lastReadChapter;
  if (lastRead != null && Number.isFinite(Number(lastRead)) && Number(lastRead) > 0) {
    return Number(lastRead);
  }
  const highest = entry?.highestReachedChapter;
  if (highest == null || !Number.isFinite(Number(highest)) || Number(highest) <= 0) {
    return null;
  }
  return getContinueChapter(chapters, Number(highest), highestChapterCompleted);
}
