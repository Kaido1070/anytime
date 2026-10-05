import assert from "node:assert/strict";
import test from "node:test";
import { getProfileAccess, onRequest } from "../functions/api/[[path]].js";

const viewer = {
  id: "viewer",
  username: "viewer",
  name: "Viewer",
  profile_visibility: "private",
};

class FakeStatement {
  constructor(db, query) {
    this.db = db;
    this.query = query;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.query.includes("FROM activity_events")) {
      this.db.sensitiveQueries.push("activity");
      return { total: 0 };
    }
    if (this.query.includes("SELECT value FROM schema_meta")) {
      return { value: "19" };
    }
    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      return {
        token_hash: "ignored",
        user_id: viewer.id,
        expires_at: Date.now() + 60_000,
        last_seen_at: Date.now(),
        ...viewer,
      };
    }
    if (this.query.includes("SELECT id, username, name, profile_visibility, avatar_id FROM users WHERE id = ?")) {
      return this.db.target;
    }
    if (this.query.includes("FROM user_lists l") && this.query.includes("owner_profile_visibility")) {
      return this.db.listRow;
    }
    if (this.query.includes("AS chapters_read")) {
      return {
        works: 4,
        chapters_read: 12,
        completed: 1,
        reading: 2,
        lists: 1,
        friends: 1,
      };
    }
    return null;
  }

  async all() {
    if (this.query.includes("FROM activity_events")) {
      this.db.sensitiveQueries.push("activity");
      return { results: [] };
    }
    if (this.query.includes("FROM favorites") && this.query.includes("total_count")) {
      return {
        results: [{ manga_id: "mt:manhwa:nano-machine", total_count: 1 }],
      };
    }
    if (this.query.includes("FROM user_library") && this.query.includes("status = 'reading'")) {
      this.db.sensitiveQueries.push("library");
      return {
        results: [
          {
            manga_id: "mt:manhwa:nano-machine",
            status: "reading",
            highest_reached_chapter: 100,
            last_read_chapter: 99,
            last_read_at: 1234,
          },
        ],
      };
    }
    if (this.query.includes("FROM user_lists l") && this.query.includes("section_position")) {
      this.db.sensitiveQueries.push("lists");
      return {
        results: [
          {
            id: "list-1",
            name: "موريم",
            description: null,
            position: 1024,
            created_at: 1,
            updated_at: 2,
            section_position: 3072,
            item_count: 1,
          },
        ],
      };
    }
    if (this.query.includes("FROM user_list_items i") && this.query.includes("row_number")) {
      this.db.sensitiveQueries.push("list-items");
      return {
        results: [
          {
            list_id: "list-1",
            manga_id: "mt:manhwa:nano-machine",
            row_number: 1,
          },
        ],
      };
    }
    if (this.query.includes("FROM user_profile_sections")) {
      return {
        results: [
          { section_type: "favorites", position: 1024 },
          { section_type: "continue_reading", position: 2048 },
        ],
      };
    }
    if (this.query.includes("FROM friendships f") && this.query.includes("LIMIT ?")) {
      this.db.sensitiveQueries.push("friends");
      return {
        results: [
          {
            id: "friend-1",
            username: "friend",
            name: "Friend",
            profile_visibility: "private",
          },
        ],
      };
    }
    if (this.query.includes("FROM user_list_items") && !this.query.includes("row_number")) {
      this.db.sensitiveQueries.push("list-detail-items");
      return {
        results: [
          { manga_id: "mt:manhwa:nano-machine", position: 1024, added_at: 1 },
        ],
      };
    }
    return { results: [] };
  }

  async run() {
    return { meta: { changes: 1 } };
  }
}

class FakeDb {
  constructor(target) {
    this.target = target;
    this.sensitiveQueries = [];
    this.listRow = null;
  }

  prepare(query) {
    return new FakeStatement(this, query);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

async function call(db, path) {
  const request = new Request(`https://wany.test/api/${path}`, {
    headers: { Cookie: "anytime_session=test-session" },
  });
  return onRequest({ request, env: { DB: db } });
}

test("central profile access distinguishes owner, public viewer, and private viewer", () => {
  assert.equal(
    getProfileAccess({ id: "a" }, { id: "a", profile_visibility: "private" }),
    "owner",
  );
  assert.equal(
    getProfileAccess({ id: "b" }, { id: "a", profile_visibility: "public" }),
    "public",
  );
  assert.equal(
    getProfileAccess({ id: "b" }, { id: "a", profile_visibility: "private" }),
    "private",
  );
});

test("private profile returns only identity and favorites without querying hidden data", async () => {
  const db = new FakeDb({
    id: "target",
    username: "target",
    name: "Target",
    profile_visibility: "private",
  });

  const response = await call(db, "profiles/target");
  assert.equal(response.status, 200);
  const { profile } = await response.json();

  assert.deepEqual(Object.keys(profile).sort(), [
    "access",
    "favoriteCount",
    "favorites",
    "relationship",
    "user",
  ]);
  assert.equal(profile.access, "private");
  assert.equal(profile.relationship, "none");
  assert.deepEqual(profile.favorites, ["mt:manhwa:nano-machine"]);
  assert.deepEqual(db.sensitiveQueries, []);
});

test("public profile exposes bounded social data and uses highest reached chapter", async () => {
  const db = new FakeDb({
    id: "target",
    username: "target",
    name: "Target",
    profile_visibility: "public",
  });

  const response = await call(db, "profiles/target");
  assert.equal(response.status, 200);
  const { profile } = await response.json();

  assert.equal(profile.access, "public");
  assert.equal(profile.library[0].highestReachedChapter, 100);
  assert.equal(profile.library[0].lastReadChapter, 99);
  assert.equal(profile.library[0].lastReadAt, 1234);
  assert.equal(profile.lists[0].name, "موريم");
  assert.equal(profile.friends[0].id, "friend-1");
  assert.deepEqual(profile.stats, {
    works: 4,
    chaptersRead: 12,
    completed: 1,
    reading: 2,
    lists: 1,
    friends: 1,
  });
  assert.ok(db.sensitiveQueries.includes("library"));
  assert.ok(db.sensitiveQueries.includes("lists"));
  assert.ok(db.sensitiveQueries.includes("friends"));
});

test("direct list access is denied when the list owner is private", async () => {
  const db = new FakeDb({
    id: "target",
    username: "target",
    name: "Target",
    profile_visibility: "private",
  });
  db.listRow = {
    id: "private-list",
    name: "مخفية",
    description: null,
    position: 1024,
    created_at: 1,
    updated_at: 1,
    owner_id: "target",
    owner_username: "target",
    owner_name: "Target",
    owner_profile_visibility: "private",
  };

  const response = await call(db, "lists/private-list");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "LIST_NOT_FOUND");
  assert.equal(db.sensitiveQueries.includes("list-detail-items"), false);
});

