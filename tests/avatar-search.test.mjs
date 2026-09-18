import test from "node:test";
import assert from "node:assert/strict";
import { filterAvatarSeries } from "../src/services/avatars.ts";

const series = [
  {
    id: "one-piece",
    workId: null,
    name: "ون بيس",
    slug: "one-piece",
    position: 1,
    avatars: [
      { id: "one-piece:luffy", seriesId: "one-piece", characterName: "لوفي", imageUrl: null, position: 1 },
      { id: "one-piece:zoro", seriesId: "one-piece", characterName: "زورو", imageUrl: null, position: 2 },
    ],
  },
  {
    id: "naruto",
    workId: null,
    name: "ناروتو",
    slug: "naruto",
    position: 2,
    avatars: [
      { id: "naruto:naruto", seriesId: "naruto", characterName: "ناروتو", imageUrl: null, position: 1 },
      { id: "naruto:kakashi", seriesId: "naruto", characterName: "كاكاشي", imageUrl: null, position: 2 },
    ],
  },
];

test("avatar search by work keeps the full matching series", () => {
  const result = filterAvatarSeries(series, "ون بيس");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "one-piece");
  assert.deepEqual(result[0].avatars.map((avatar) => avatar.id), [
    "one-piece:luffy",
    "one-piece:zoro",
  ]);
});

test("avatar search by character keeps only the matching character", () => {
  const result = filterAvatarSeries(series, "زورو");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "one-piece");
  assert.deepEqual(result[0].avatars.map((avatar) => avatar.id), [
    "one-piece:zoro",
  ]);
});

test("empty avatar search preserves fixed series ordering", () => {
  const result = filterAvatarSeries(series, "   ");
  assert.deepEqual(result.map((group) => group.id), ["one-piece", "naruto"]);
});
