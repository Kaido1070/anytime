import type { SourceChapter, SourceManga } from "../types";

export function parseChapterInput(value: string): number | null {
  const normalized = value.trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٫,،]/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export async function resolveChapterJump(
  item: SourceManga,
  input: string,
  loadChapter: (key: string, number: number) => Promise<SourceChapter>,
): Promise<SourceChapter> {
  const number = parseChapterInput(input);
  if (number == null) throw new Error("اكتب رقم فصل صحيح");
  const local = item.chapters?.find((entry) => Math.abs(Number(entry.number) - number) < 0.000001);
  if (local) return local;
  // A paginated preview cannot prove a chapter is missing. Resolve it from
  // the archive without downloading chapter images.
  const resolved = await loadChapter(item.key, number);
  const resultNumber = Number(resolved.number);
  const exact = Math.abs(resultNumber - number) < 0.000001;
  const part = Number.isInteger(number) && resultNumber > number && resultNumber < number + 1;
  if (!Number.isFinite(resultNumber) || (!exact && !part)) {
    throw new Error("المصدر رجع فصلًا مختلفًا عن الرقم المطلوب");
  }
  return resolved;
}
