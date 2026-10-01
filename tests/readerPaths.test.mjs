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


test("MangaTime reader path preserves the canonical source key instead of rebuilding it from the slug", () => {
  const mangaTimeItem = {
    key: "mt:1842",
    source: "mangatime",
    slug: "solo-leveling",
  };

  assert.equal(
    readerPath(mangaTimeItem, 201),
    "/read-source/mt%3A1842/201",
  );
});

test("MangaTime canonical reader path keeps merged source context for fallback", () => {
  const mangaTimeItem = {
    key: "mt:1842",
    source: "mangatime",
    slug: "solo-leveling",
  };

  assert.equal(
    readerPath(mangaTimeItem, 201, ["ml:solo-leveling", "mt:1842"]),
    "/read-source/mt%3A1842/201?sources=mt%3A1842%2Cml%3Asolo-leveling",
  );
});
