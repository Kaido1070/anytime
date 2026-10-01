import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reader = await readFile(
  new URL("../src/pages/SourceReader.tsx", import.meta.url),
  "utf8",
);
const details = await readFile(
  new URL("../src/pages/SourceMangaDetails.tsx", import.meta.url),
  "utf8",
);
const sources = await readFile(
  new URL("../src/services/sources.ts", import.meta.url),
  "utf8",
);

test("reader carries exact source chapter identity from list click to API", () => {
  assert.match(
    details,
    /readerPath\(item, chapter\.number, requestedSourceKeys, chapter\.url\)/,
  );
  assert.match(
    reader,
    /const exactChapterUrl = searchParams\.get\("chapterUrl"\)\?\.trim\(\) \|\| undefined;/,
  );
  assert.match(
    reader,
    /sourceService\.getChapter\(sourceKey, number, exactChapterUrl\)/,
  );
  assert.match(
    sources,
    /params\(\{ key, number: chapter, chapterUrl \}\)/,
  );
});

test("reader chapter selector navigates by row URL, not chapter number alone", () => {
  assert.match(
    reader,
    /readerPath\(\s*payload\.item,\s*entry\.number,\s*sourceKeys,\s*entry\.url,/,
  );
  assert.match(
    reader,
    /key=\{entry\.url \|\|/,
  );
  assert.match(
    reader,
    /payload\.chapterUrl \|\| selectedChapter\?\.url \|\| payload\.item\.url/,
  );
});
