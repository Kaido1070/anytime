import test from "node:test";
import assert from "node:assert/strict";
import { readerPath } from "../src/services/readerPaths.ts";

const item = {
  key: "sz:overgeared",
  source: "starzmanga",
  slug: "overgeared",
};

test("reader path carries merged source keys for fallback", () => {
  const path = readerPath(item, 120, ["sz:overgeared", "ml:overgeared"]);

  assert.equal(
    path,
    "/read-source/sz%3Aovergeared/120?sources=sz%3Aovergeared%2Cml%3Aovergeared",
  );
});

test("reader path does not add source context for a single source", () => {
  assert.equal(readerPath(item, 120), "/read-source/sz%3Aovergeared/120");
});

test("reader path deduplicates the active source key", () => {
  const path = readerPath(item, 120, ["sz:overgeared", "ml:overgeared"]);

  assert.equal(
    path,
    "/read-source/sz%3Aovergeared/120?sources=sz%3Aovergeared%2Cml%3Aovergeared",
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


test("XSano reader path preserves the canonical source key instead of rebuilding it from the slug", () => {
  const xsanoItem = {
    key: "xs:8f3d19a2",
    source: "xsano",
    slug: "the-player-hides-his-past",
  };

  assert.equal(
    readerPath(xsanoItem, 77),
    "/read-source/xs%3A8f3d19a2/77",
  );
});

test("XSano canonical reader path keeps merged source context for fallback", () => {
  const xsanoItem = {
    key: "xs:8f3d19a2",
    source: "xsano",
    slug: "the-player-hides-his-past",
  };

  assert.equal(
    readerPath(xsanoItem, 77, ["ml:the-player-hides-his-past", "xs:8f3d19a2"]),
    "/read-source/xs%3A8f3d19a2/77?sources=xs%3A8f3d19a2%2Cml%3Athe-player-hides-his-past",
  );
});


test("MangaLik reader path preserves the canonical source key instead of rebuilding it from a normalized slug", () => {
  const mangaLikItem = {
    key: "ml:ready_action",
    source: "mangalik",
    slug: "ready.action",
  };

  assert.equal(
    readerPath(mangaLikItem, 1),
    "/read-source/ml%3Aready_action/1",
  );
});

test("MangaLik canonical reader path keeps merged source context", () => {
  const mangaLikItem = {
    key: "ml:overgeared",
    source: "mangalik",
    slug: "overgeared",
  };

  assert.equal(
    readerPath(mangaLikItem, 120, ["sz:overgeared", "ml:overgeared"]),
    "/read-source/ml%3Aovergeared/120?sources=ml%3Aovergeared%2Csz%3Aovergeared",
  );
});


test("StarzManga reader path preserves a normalized canonical key", () => {
  const starzItem = {
    key: "sz:series_name",
    source: "starzmanga",
    slug: "series.name",
  };

  assert.equal(
    readerPath(starzItem, 12),
    "/read-source/sz%3Aseries_name/12",
  );
});

test("3asq reader path preserves a normalized canonical key", () => {
  const asqItem = {
    key: "aq:series_name",
    source: "3asq",
    slug: "series.name",
  };

  assert.equal(
    readerPath(asqItem, 12),
    "/read-source/aq%3Aseries_name/12",
  );
});

test("Azora reader keeps the direct slug route used by its chapter URLs", () => {
  const azoraItem = {
    key: "az:shadow-slave",
    source: "azora",
    slug: "shadow-slave",
  };

  assert.equal(
    readerPath(azoraItem, 12),
    "/read/azora/shadow-slave/12",
  );
});


test("reader path carries the exact non-Team-X chapter URL", () => {
  const azoraItem = {
    key: "az:youth-set-menu",
    source: "azora",
    slug: "youth-set-menu",
  };
  const chapterUrl = "https://azorafly.com/series/youth-set-menu/chapter-8-continuation";

  assert.equal(
    readerPath(azoraItem, 8, [], chapterUrl),
    "/read/azora/youth-set-menu/8?chapterUrl=" + encodeURIComponent(chapterUrl),
  );
});

test("Team-X reader path ignores exact chapter URL metadata", () => {
  const teamXItem = {
    key: "tx:example",
    source: "teamx",
    slug: "example",
  };

  assert.equal(
    readerPath(
      teamXItem,
      8,
      [],
      "https://olympustaff.com/series/example/chapter-8",
    ),
    "/read/teamx/example/8",
  );
});
