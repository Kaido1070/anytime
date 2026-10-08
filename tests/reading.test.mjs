import test from "node:test";
import assert from "node:assert/strict";
import { getContinueChapter, getResumeChapter, mergeLibraryRead } from "../src/services/reading.ts";

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

test("resume uses last opened chapter even if the archive begins at chapter 394.3", () => {
  const entry = { lastReadChapter: 3, highestReachedChapter: 407.3 };
  const visibleArchive = [{ number: 394.3 }, { number: 395 }, { number: 407.3 }];
  assert.equal(getResumeChapter(entry, visibleArchive, true), 3);
  assert.equal(getResumeChapter(entry, visibleArchive, false), 3);
});

test("resume does not regress when rereading a chapter or switching story", () => {
  const reread = mergeLibraryRead({ mangaId: "tx:example", lastReadChapter: 407.3, highestReachedChapter: 407.3 }, "tx:example", 4, Date.now());
  assert.equal(getResumeChapter(reread, [{ number: 394.3 }], false), 4);
  assert.equal(getResumeChapter({ highestReachedChapter: 3, lastReadChapter: null }, [{ number: 394.3 }], false), 3);
  assert.equal(getResumeChapter(undefined, [{ number: 394.3 }], false), null);
});

test("resume falls back to the next chapter only for legacy records with no last-read", () => {
  assert.equal(getResumeChapter(
    { highestReachedChapter: 5, lastReadChapter: null },
    [{ number: 5 }, { number: 6 }],
    true,
  ), 6);
});
