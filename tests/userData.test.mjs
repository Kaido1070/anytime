import test from "node:test";
import assert from "node:assert/strict";
import { userDataService as service } from "../src/services/userData.ts";
const values = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  },
  configurable: true,
});
test("mock login, isolated favorites, chapter progress, completion, and sign-out", async () => {
  assert.equal(await service.getUser(), null);
  await assert.rejects(service.signIn("Mahdi", "wrong"));
  await service.signIn(" MAHDI ", "anytime");
  assert.equal((await service.getUser()).name, "Mahdi");
  await service.addFavorite("eleceed");
  await service.addFavorite("eleceed");
  assert.equal(
    (await service.getFavorites()).filter((id) => id === "eleceed").length,
    1,
  );
  await service.removeFavorite("solo");
  assert.equal((await service.getFavorites()).includes("solo"), false);
  await service.saveReadingProgress({
    mangaId: "returner",
    chapter: 148,
    percent: 64,
    updatedAt: 10,
  });
  assert.equal(
    (await service.getReadingProgress())["returner:148"].percent,
    64,
  );
  assert.deepEqual((await service.getData()).lastOpened, {
    mangaId: "returner",
    chapter: 148,
  });
  await service.saveReadingProgress({
    mangaId: "returner",
    chapter: 148,
    percent: 100,
    updatedAt: 11,
  });
  assert.ok((await service.getData()).completed.includes("returner:148"));
  await service.signOut();
  assert.equal(await service.getUser(), null);
  await assert.rejects(service.getFavorites());
  await service.signIn("Kaido", "anytime");
  assert.equal((await service.getFavorites()).includes("eleceed"), false);
  assert.equal(
    (await service.getFriends()).some((friend) => friend.user.id === "kaido"),
    false,
  );
  await service.signIn("Mahdi", "anytime");
  assert.equal((await service.getFavorites()).includes("eleceed"), true);
  assert.equal(
    (await service.getReadingProgress())["returner:148"].percent,
    100,
  );
});
test("corrupt storage recovers a usable library", async () => {
  values.set("anytime:v1:user:mahdi", "{broken");
  assert.deepEqual(await service.getFavorites(), ["returner", "solo"]);
  await service.addFavorite("horizon");
  assert.ok((await service.getFavorites()).includes("horizon"));
});
