import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  },
  configurable: true,
});

const user = { id: "mahdi", username: "has", name: "Has" };
let signedIn = false;
let serverData = {
  version: 2,
  favorites: ["returner", "solo"],
  progress: {},
  completed: [],
  lastOpened: null,
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Object.defineProperty(globalThis, "fetch", {
  value: async (input, init = {}) => {
    const url = String(input);
    const path = url.replace(/^.*\/api\//, "");
    const method = init.method ?? "GET";

    if (path === "session" && method === "GET")
      return response({ user: signedIn ? user : null });
    if (path === "login" && method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.username !== "has" || body.password !== "anytime")
        return response({ message: "bad login" }, 401);
      signedIn = true;
      return response({ user });
    }
    if (path === "logout" && method === "POST") {
      signedIn = false;
      return response({ ok: true });
    }
    if (path === "data" && method === "GET") return response({ data: serverData });
    if (path === "import" && method === "POST") return response({ data: serverData });
    if (path === "favorites" && method === "POST") {
      const body = JSON.parse(String(init.body));
      serverData = {
        ...serverData,
        favorites: [...new Set([...serverData.favorites, body.mangaId])],
      };
      return response({ ok: true });
    }
    if (path.startsWith("favorites/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("favorites/".length));
      serverData = {
        ...serverData,
        favorites: serverData.favorites.filter((item) => item !== id),
      };
      return response({ ok: true });
    }
    if (path === "progress" && method === "PUT") {
      const progress = JSON.parse(String(init.body));
      const key = `${progress.mangaId}:${progress.chapter}`;
      serverData = {
        ...serverData,
        progress: { ...serverData.progress, [key]: progress },
        completed:
          progress.percent >= 98
            ? [...new Set([...serverData.completed, key])]
            : serverData.completed,
        lastOpened: { mangaId: progress.mangaId, chapter: progress.chapter },
      };
      return response({ ok: true });
    }
    if (path === "friends" && method === "GET") return response({ friends: [] });
    if (path === "change-password" && method === "POST") return response({ ok: true });
    return response({ message: `Unhandled ${method} ${path}` }, 500);
  },
  configurable: true,
});

test("Phase 2 API service logs in and syncs favorites/progress", async () => {
  const { userDataService: service } = await import("../src/services/userData.ts");

  assert.equal(await service.getUser(), null);
  await assert.rejects(service.signIn("has", "wrong"));
  assert.equal((await service.signIn(" HAS ", "anytime")).name, "Has");

  await service.addFavorite("eleceed");
  assert.ok((await service.getFavorites()).includes("eleceed"));

  await service.removeFavorite("solo");
  assert.equal((await service.getFavorites()).includes("solo"), false);

  await service.saveReadingProgress({
    mangaId: "returner",
    chapter: 148,
    percent: 100,
    updatedAt: 10,
  });
  const data = await service.getData();
  assert.equal(data.progress["returner:148"].percent, 100);
  assert.ok(data.completed.includes("returner:148"));
  assert.deepEqual(data.lastOpened, { mangaId: "returner", chapter: 148 });

  await service.changePassword("anytime", "new-pass");
  await service.signOut();
  assert.equal(await service.getUser(), null);
});
