import test from "node:test";
import assert from "node:assert/strict";
import { readerPath } from "../src/services/readerPaths.ts";

const item = {
  key: "ml:overgeared",
  source: "mangalik",
  slug: "overgeared",
};

test("reader path carries merged source keys for fallback", () => {
  const path = readerPath(item, 120, ["sz:overgeared", "ml:overgeared"]);

  assert.equal(
    path,
    "/read/mangalik/overgeared/120?sources=ml%3Aovergeared%2Csz%3Aovergeared",
  );
});

test("reader path does not add source context for a single source", () => {
  assert.equal(readerPath(item, 120), "/read/mangalik/overgeared/120");
});

test("reader path deduplicates the active source key", () => {
  const path = readerPath(item, 120, ["ml:overgeared", "sz:overgeared"]);

  assert.equal(
    path,
    "/read/mangalik/overgeared/120?sources=ml%3Aovergeared%2Csz%3Aovergeared",
  );
});
