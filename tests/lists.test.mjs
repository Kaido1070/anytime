import assert from "node:assert/strict";
import test from "node:test";

const user = { id: "has", username: "has", name: "Has" };
const nano = "mt:manhwa:nano-machine";
const solo = "tx:solo-leveling";
const omni = "aq:omniscient-reader";

let nextListId = 1;
let now = 1_800_000_000_000;
let lists = [];
let listItems = new Map();
let readingHistory = [
  { id: 1, mangaId: nano, chapter: 180, readAt: now - 1000 },
];
const serverData = {
  version: 3,
  favorites: [nano],
  library: [
    {
      mangaId: nano,
      status: "reading",
      addedAt: now - 5000,
      updatedAt: now - 1000,
      lastReadAt: now - 1000,
      lastReadChapter: 180,
      highestReachedChapter: 180,
    },
  ],
  progress: {
    [`${nano}:180`]: {
      mangaId: nano,
      chapter: 180,
      percent: 42,
      updatedAt: now - 1000,
    },
  },
  completed: [],
  lastOpened: { mangaId: nano, chapter: 180 },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function summary(list) {
  return {
    ...list,
    itemCount: (listItems.get(list.id) ?? []).length,
  };
}

function orderedItems(listId) {
  return [...(listItems.get(listId) ?? [])]
    .sort((a, b) => a.position - b.position || a.addedAt - b.addedAt)
    .map((item) => ({ ...item }));
}

Object.defineProperty(globalThis, "fetch", {
  value: async (input, init = {}) => {
    const url = new URL(String(input), "https://wany.test");
    const path = url.pathname.replace(/^\/api\/?/, "");
    const method = String(init.method ?? "GET").toUpperCase();

    if (path === "session" && method === "GET") return json({ user });
    if (path === "cleanup-demo" && method === "POST") return json({ ok: true });
    if (path === "data" && method === "GET") return json({ data: serverData });
    if (path.startsWith("reading/history") && method === "GET") {
      return json({ history: readingHistory });
    }

    if (path === "lists" && method === "GET") {
      return json({ lists: lists.map(summary) });
    }

    if (path === "lists" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const list = {
        id: `list-${nextListId++}`,
        name: body.name,
        description: body.description || null,
        position: (lists.at(-1)?.position ?? 0) + 1024,
        createdAt: ++now,
        updatedAt: now,
      };
      lists.push(list);
      listItems.set(list.id, []);
      return json({ list: summary(list) }, 201);
    }

    if (path.startsWith("lists/membership/") && method === "GET") {
      const mangaId = decodeURIComponent(path.slice("lists/membership/".length));
      const listIds = lists
        .filter((list) => (listItems.get(list.id) ?? []).some((item) => item.mangaId === mangaId))
        .map((list) => list.id);
      return json({ listIds });
    }

    const reorderMatch = path.match(/^lists\/([^/]+)\/reorder$/);
    if (reorderMatch && method === "PUT") {
      const listId = decodeURIComponent(reorderMatch[1]);
      const body = JSON.parse(String(init.body));
      const current = orderedItems(listId);
      const moving = current.find((item) => item.mangaId === body.mangaId);
      if (!moving) return json({ error: "LIST_ITEM_NOT_FOUND" }, 404);
      const remaining = current.filter((item) => item.mangaId !== body.mangaId);
      let targetIndex = remaining.length;
      if (body.beforeId) {
        targetIndex = remaining.findIndex((item) => item.mangaId === body.beforeId);
      } else if (body.afterId) {
        targetIndex = remaining.findIndex((item) => item.mangaId === body.afterId) + 1;
      }
      if (targetIndex < 0) return json({ error: "INVALID_REORDER_TARGET" }, 409);
      remaining.splice(targetIndex, 0, moving);
      listItems.set(
        listId,
        remaining.map((item, index) => ({ ...item, position: (index + 1) * 1024 })),
      );
      return json({ ok: true });
    }

    const itemMatch = path.match(/^lists\/([^/]+)\/items(?:\/(.+))?$/);
    if (itemMatch) {
      const listId = decodeURIComponent(itemMatch[1]);
      if (!lists.some((list) => list.id === listId)) return json({ error: "LIST_NOT_FOUND" }, 404);

      if (method === "POST" && !itemMatch[2]) {
        const body = JSON.parse(String(init.body));
        const current = listItems.get(listId) ?? [];
        if (!current.some((item) => item.mangaId === body.mangaId)) {
          current.push({
            mangaId: body.mangaId,
            position: (current.at(-1)?.position ?? 0) + 1024,
            addedAt: ++now,
          });
        }
        listItems.set(listId, current);
        return json({ ok: true }, 201);
      }

      if (method === "DELETE" && itemMatch[2]) {
        const mangaId = decodeURIComponent(itemMatch[2]);
        listItems.set(
          listId,
          (listItems.get(listId) ?? []).filter((item) => item.mangaId !== mangaId),
        );
        return json({ ok: true });
      }
    }

    const listMatch = path.match(/^lists\/([^/]+)$/);
    if (listMatch) {
      const listId = decodeURIComponent(listMatch[1]);
      const list = lists.find((entry) => entry.id === listId);
      if (!list) return json({ error: "LIST_NOT_FOUND" }, 404);

      if (method === "GET") {
        return json({ list: summary(list), items: orderedItems(listId) });
      }

      if (method === "PUT") {
        const body = JSON.parse(String(init.body));
        list.name = body.name;
        list.description = body.description || null;
        list.updatedAt = ++now;
        return json({ list: summary(list) });
      }

      if (method === "DELETE") {
        lists = lists.filter((entry) => entry.id !== listId);
        listItems.delete(listId);
        return json({ ok: true });
      }
    }

    return json({ error: `Unhandled ${method} ${path}` }, 500);
  },
  configurable: true,
});

test("personal lists allow multi-list membership, persistent ordering, and isolated deletion", async () => {
  const { userDataService: service } = await import("../src/services/userData.ts");

  assert.equal((await service.getUser())?.id, user.id);

  const murim = await service.createList("موريم", "أفضل أعمال الموريم");
  const best = await service.createList("أفضل الأعمال", "");

  await service.addWorkToList(murim.id, nano);
  await service.addWorkToList(best.id, nano);

  assert.deepEqual(
    (await service.getListMembership(nano)).sort(),
    [best.id, murim.id].sort(),
  );

  await service.addWorkToList(murim.id, solo);
  await service.addWorkToList(murim.id, omni);
  await service.addWorkToList(murim.id, nano);

  assert.deepEqual(
    (await service.getList(murim.id)).items.map((item) => item.mangaId),
    [nano, solo, omni],
    "adding the same work twice must not duplicate it in one list",
  );

  await service.reorderListItem(murim.id, omni, nano, null);

  assert.deepEqual(
    (await service.getList(murim.id)).items.map((item) => item.mangaId),
    [omni, nano, solo],
    "re-fetching the list must preserve the backend order",
  );

  const readingBefore = JSON.stringify(serverData);
  const historyBefore = JSON.stringify(readingHistory);

  await service.removeWorkFromList(best.id, nano);
  assert.deepEqual(await service.getListMembership(nano), [murim.id]);
  assert.equal(
    (await service.getData()).library.some((item) => item.mangaId === nano),
    true,
    "removing from one list must not remove the work from the user library",
  );

  const renamed = await service.updateList(murim.id, "موريم المفضلة", "مرتبة يدويًا");
  assert.equal(renamed.name, "موريم المفضلة");
  assert.equal(renamed.description, "مرتبة يدويًا");

  const temporary = await service.createList("تجريبية", "");
  await service.addWorkToList(temporary.id, nano);
  await service.deleteList(temporary.id);

  assert.equal((await service.getLists()).some((list) => list.id === temporary.id), false);
  assert.equal(JSON.stringify(serverData), readingBefore);
  assert.equal(JSON.stringify(await service.getReadingHistory()), historyBefore);
});
