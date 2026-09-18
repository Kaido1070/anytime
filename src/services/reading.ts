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
