import test from "node:test";
import assert from "node:assert/strict";
import { getContinueChapter, mergeLibraryRead } from "../src/services/reading.ts";

test("highest reached chapter never regresses when rereading an older chapter", () => {
  const first = mergeLibraryRead(undefined, "mt:work", 10, 100);
  const second = mergeLibraryRead(first, "mt:work", 11, 200);
  const reread = mergeLibraryRead(second, "mt:work", 5, 300);

  assert.equal(reread.lastReadChapter, 5);
  assert.equal(reread.highestReachedChapter, 11);
  assert.equal(reread.status, "reading");
});

test("continue reading advances only when the highest chapter is completed", () => {
  const chapters = [{ number: 5 }, { number: 10 }, { number: 11 }, { number: 11.5 }, { number: 12 }];
  assert.equal(getContinueChapter(chapters, 11, false), 11);
  assert.equal(getContinueChapter(chapters, 11, true), 11.5);
  assert.equal(getContinueChapter(chapters, 12, true), 12);
});
