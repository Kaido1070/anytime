import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readerSource = await readFile(
  new URL("../src/pages/SourceReader.tsx", import.meta.url),
  "utf8",
);

test("reader retries failed images after connectivity returns", () => {
  assert.match(
    readerSource,
    /const READER_IMAGE_RETRY_DELAYS_MS = \[900, 2200\] as const;/,
  );
  assert.match(
    readerSource,
    /navigator\.onLine === false/,
  );
  assert.match(
    readerSource,
    /window\.addEventListener\("online", retryUnsettledPages\)/,
  );
  assert.match(
    readerSource,
    /window\.addEventListener\("focus", retryUnsettledPages\)/,
  );
});

test("reader retries requested images that never settled on iOS", () => {
  assert.match(
    readerSource,
    /const loadedRef = useRef<Set<number>>\(new Set\(\)\)/,
  );
  assert.match(
    readerSource,
    /\.\.\.requestedRef\.current/,
  );
  assert.match(
    readerSource,
    /if \(loadedRef\.current\.has\(index\)\) continue;/,
  );
  assert.match(
    readerSource,
    /activeRef\.current\.delete\(index\);[\s\S]*requestedRef\.current\.delete\(index\);/,
  );
});

test("reader cache-busts bounded image retries", () => {
  assert.match(
    readerSource,
    /wany_retry=\$\{retryVersion\}/,
  );
  assert.match(
    readerSource,
    /retryCount >= READER_IMAGE_RETRY_DELAYS_MS\.length/,
  );
});
