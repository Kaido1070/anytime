import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  },
  configurable: true,
});

const user = { id: "mahdi", username: "has", name: "Has" };
let signedIn = false;
let nextHistoryId = 1;
let now = 1000;
let history = [];
let serverData = {
  version: 3,
  favorites: ["returner", "mt:manhwa:live-title:1"],
  library: [],
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

function upsertLibraryRead(mangaId, chapter, readAt) {
  const current = serverData.library.find((item) => item.mangaId === mangaId);
  const highest = current?.highestReachedChapter;
  const next = {
    mangaId,
    status: !current || current.status === "planned" ? "reading" : current.status,
    addedAt: current?.addedAt ?? readAt,
    updatedAt: readAt,
    lastReadAt: readAt,
    lastReadChapter: chapter,
    highestReachedChapter: highest == null ? chapter : Math.max(highest, chapter),
  };
  serverData = {
    ...serverData,
    library: [next, ...serverData.library.filter((item) => item.mangaId !== mangaId)],
    lastOpened: { mangaId, chapter },
  };
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
    if (path === "cleanup-demo" && method === "POST") {
      serverData = {
        ...serverData,
        favorites: serverData.favorites.filter((id) => /^(mt|tx|aq|sz|xs|ml):/.test(id)),
        library: serverData.library.filter((item) => /^(mt|tx|aq|sz|xs|ml):/.test(item.mangaId)),
      };
      return response({ ok: true });
    }
    if (path === "logout" && method === "POST") {
      signedIn = false;
      return response({ ok: true });
    }
    if (path === "data" && method === "GET") return response({ data: serverData });
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
    if (path === "library" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const existing = serverData.library.find((item) => item.mangaId === body.mangaId);
      const time = ++now;
      const next = existing ?? {
        mangaId: body.mangaId,
        status: body.status ?? "planned",
        addedAt: time,
        updatedAt: time,
        lastReadAt: null,
        lastReadChapter: null,
        highestReachedChapter: null,
      };
      serverData = {
        ...serverData,
        library: [next, ...serverData.library.filter((item) => item.mangaId !== body.mangaId)],
      };
      return response({ ok: true }, 201);
    }
    if (path === "library" && method === "PUT") {
      const body = JSON.parse(String(init.body));
      serverData = {
        ...serverData,
        library: serverData.library.map((item) =>
          item.mangaId === body.mangaId ? { ...item, status: body.status, updatedAt: ++now } : item,
        ),
      };
      return response({ ok: true });
    }
    if (path === "reading/open" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const readAt = ++now;
      upsertLibraryRead(body.mangaId, body.chapter, readAt);
      history.unshift({
        id: nextHistoryId++,
        mangaId: body.mangaId,
        chapter: body.chapter,
        readAt,
      });
      return response({ ok: true, readAt });
    }
    if (path.startsWith("reading/history?") && method === "GET")
      return response({ history });
    if (path === "progress" && method === "PUT") {
      const progress = JSON.parse(String(init.body));
      const key = `${progress.mangaId}:${progress.chapter}`;
      upsertLibraryRead(progress.mangaId, progress.chapter, progress.updatedAt);
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

test("API service supports library, reading history, and non-regressing highest chapter", async () => {
  const { userDataService: service } = await import("../src/services/userData.ts");

  assert.equal(await service.getUser(), null);
  await assert.rejects(service.signIn("has", "wrong"));
  assert.equal((await service.signIn(" HAS ", "anytime")).name, "Has");

  const mangaId = "mt:manhwa:reader-title-2";
  await service.addToLibrary(mangaId, "planned");
  assert.equal((await service.getData()).library[0].status, "planned");

  await service.recordChapterOpen(mangaId, 10);
  await service.saveReadingProgress({
    mangaId,
    chapter: 10,
    percent: 100,
    updatedAt: ++now,
  });

  await service.recordChapterOpen(mangaId, 11);
  await service.saveReadingProgress({
    mangaId,
    chapter: 11,
    percent: 100,
    updatedAt: ++now,
  });

  await service.recordChapterOpen(mangaId, 5);

  const data = await service.getData();
  const item = data.library.find((entry) => entry.mangaId === mangaId);
  assert.equal(item.lastReadChapter, 5);
  assert.equal(item.highestReachedChapter, 11);

  const readingHistory = await service.getReadingHistory();
  assert.deepEqual(
    readingHistory.slice(0, 3).map((entry) => entry.chapter),
    [5, 11, 10],
  );

  await service.setLibraryStatus(mangaId, "paused");
  assert.equal((await service.getData()).library[0].status, "paused");

  await service.signOut();
  assert.equal(await service.getUser(), null);
});
