import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].js";

class FakeStatement {
  constructor(query) {
    this.query = query;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.query.includes("SELECT value FROM schema_meta")) {
      return { value: "20" };
    }
    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      return {
        token_hash: "ignored",
        user_id: "user-a",
        expires_at: Date.now() + 60_000,
        last_seen_at: Date.now(),
        id: "user-a",
        username: "usera",
        name: "User A",
      };
    }
    if (this.query.includes("SELECT id FROM user_lists WHERE id = ? AND user_id = ?")) {
      return null;
    }
    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    if (
      this.query.includes("UPDATE user_lists") ||
      this.query.includes("DELETE FROM user_lists")
    ) {
      return { meta: { changes: 0 } };
    }
    return { meta: { changes: 1 } };
  }
}

const db = {
  prepare(query) {
    return new FakeStatement(query);
  },
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  },
};

async function call(path, method, body) {
  const request = new Request(`https://wany.test/api/${path}`, {
    method,
    headers: {
      Origin: "https://wany.test",
      Cookie: "anytime_session=test-session",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return onRequest({ request, env: { DB: db } });
}

test("backend rejects every personal-list mutation when the list is not owned by the session user", async () => {
  const listId = "someone-elses-list";
  const mangaId = "mt:manhwa:nano-machine";

  const add = await call(`lists/${listId}/items`, "POST", { mangaId });
  assert.equal(add.status, 404);
  assert.equal((await add.json()).error, "LIST_NOT_FOUND");

  const remove = await call(
    `lists/${listId}/items/${encodeURIComponent(mangaId)}`,
    "DELETE",
  );
  assert.equal(remove.status, 404);
  assert.equal((await remove.json()).error, "LIST_NOT_FOUND");

  const reorder = await call(`lists/${listId}/reorder`, "PUT", {
    mangaId,
    beforeId: null,
    afterId: null,
  });
  assert.equal(reorder.status, 404);
  assert.equal((await reorder.json()).error, "LIST_NOT_FOUND");

  const edit = await call(`lists/${listId}`, "PUT", {
    name: "لا يسمح",
    description: "",
  });
  assert.equal(edit.status, 404);
  assert.equal((await edit.json()).error, "LIST_NOT_FOUND");

  const removeList = await call(`lists/${listId}`, "DELETE");
  assert.equal(removeList.status, 404);
  assert.equal((await removeList.json()).error, "LIST_NOT_FOUND");
});
