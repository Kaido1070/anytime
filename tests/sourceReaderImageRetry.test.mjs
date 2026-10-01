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
    /window\.addEventListener\("online", retryPendingPages\)/,
  );
});

test("failed reader images are released before their bounded retry", () => {
  assert.match(
    readerSource,
    /requestedRef\.current\.delete\(index\);[\s\S]*setRequestedPages\(new Set\(requestedRef\.current\)\)/,
  );
  assert.match(
    readerSource,
    /retryCount >= READER_IMAGE_RETRY_DELAYS_MS\.length/,
  );
});
