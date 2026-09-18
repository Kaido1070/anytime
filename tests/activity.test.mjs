import assert from "node:assert/strict";
import test from "node:test";
import {
  onRequest,
  recordProgressActivity,
  shouldAggregateProgressActivity,
} from "../functions/api/[[path]].js";

class ProgressActivityStatement {
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
    if (this.query.includes("FROM activity_events") && this.query.includes("progress_reached")) {
      const [userId, mangaId] = this.args;
      const matches = this.db.events
        .filter(
          (event) =>
            event.user_id === userId &&
            event.manga_id === mangaId &&
            event.type === "progress_reached",
        )
        .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id);
      return matches[0] ?? null;
    }
    return null;
  }

  async run() {
    if (this.query.includes("UPDATE activity_events")) {
      const [chapter, createdAt, updatedAt, id, userId] = this.args;
      const event = this.db.events.find(
        (item) => item.id === id && item.user_id === userId && item.type === "progress_reached",
      );
      if (!event) return { meta: { changes: 0 } };
      event.chapter_number = chapter;
      event.created_at = createdAt;
      event.updated_at = updatedAt;
      return { meta: { changes: 1 } };
    }

    if (this.query.includes("INSERT INTO activity_events")) {
      const [userId, mangaId, chapter, createdAt, updatedAt] = this.args;
      this.db.events.push({
        id: this.db.nextId++,
        user_id: userId,
        type: "progress_reached",
        manga_id: mangaId,
        chapter_number: chapter,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }
}

class ProgressActivityDb {
  constructor() {
    this.events = [];
    this.nextId = 1;
  }

  prepare(query) {
    return new ProgressActivityStatement(this, query);
  }
}

test("progress aggregation keeps one latest event inside the documented 30-minute window", async () => {
  const db = new ProgressActivityDb();
  const start = 1_000_000;

  await recordProgressActivity(db, "a", "mt:work", 100, start);
  await recordProgressActivity(db, "a", "mt:work", 101, start + 5 * 60 * 1000);
  await recordProgressActivity(db, "a", "mt:work", 102, start + 20 * 60 * 1000);

  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].chapter_number, 102);
  assert.equal(db.events[0].created_at, start + 20 * 60 * 1000);
});

test("progress aggregation never moves a visible event backward", async () => {
  const db = new ProgressActivityDb();
  const start = 2_000_000;

  await recordProgressActivity(db, "a", "mt:work", 120, start);
  await recordProgressActivity(db, "a", "mt:work", 40, start + 5 * 60 * 1000);

  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].chapter_number, 120);
});

test("progress after the aggregation window creates a new meaningful event", async () => {
  const db = new ProgressActivityDb();
  const start = 3_000_000;

  await recordProgressActivity(db, "a", "mt:work", 100, start);
  await recordProgressActivity(db, "a", "mt:work", 104, start + 31 * 60 * 1000);

  assert.equal(db.events.length, 2);
  assert.equal(db.events[1].chapter_number, 104);
  assert.equal(shouldAggregateProgressActivity(start, start + 31 * 60 * 1000), false);
});

class RouteStatement {
  constructor(db, query) {
    this.db = db;
    this.query = query;
    this.args = [];
    this.db.queries.push(query);
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.query.includes("SELECT value FROM schema_meta")) return { value: "8" };
    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      return {
        token_hash: "token",
        user_id: "viewer",
        id: "viewer",
        username: "viewer",
        name: "Viewer",
        profile_visibility: "private",
        expires_at: Date.now() + 60_000,
        last_seen_at: Date.now(),
      };
    }
    if (this.query.includes("SELECT COUNT(*) AS total") && this.query.includes("activity_events")) {
      return { total: 1 };
    }
    return null;
  }

  async all() {
    if (
      this.query.includes("FROM activity_events e") &&
      this.query.includes("JOIN friendships f")
    ) {
      return {
        results: [
          {
            id: 1,
            type: "completed_work",
            user_id: "friend-public",
            manga_id: "mt:work",
            list_id: null,
            chapter_number: null,
            created_at: 100,
            updated_at: 100,
            username: "friend",
            name: "Friend",
            profile_visibility: "public",
            list_name: null,
          },
        ],
      };
    }
    return { results: [] };
  }

  async run() {
    return { meta: { changes: 1 } };
  }
}

class RouteDb {
  constructor() {
    this.queries = [];
  }

  prepare(query) {
    return new RouteStatement(this, query);
  }
}

async function call(db, method, path, body) {
  const request = new Request(`https://wany.test/api/${path}`, {
    method,
    headers: {
      Cookie: "anytime_session=test-session",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await onRequest({ request, env: { DB: db } });
  return { response, payload: await response.json() };
}

test("friends activity is filtered in backend by current friendship and current public visibility", async () => {
  const db = new RouteDb();
  const { response, payload } = await call(db, "GET", "activity/friends");

  assert.equal(response.status, 200);
  assert.equal(payload.events.length, 1);
  const query = db.queries.find(
    (value) => value.includes("FROM activity_events e") && value.includes("LIMIT ? OFFSET ?"),
  );
  assert.match(query, /JOIN friendships f ON f\.user_id = \? AND f\.friend_id = e\.user_id/);
  assert.match(query, /u\.profile_visibility = 'public'/);
});

test("client cannot create arbitrary activity through an activity endpoint", async () => {
  const db = new RouteDb();
  const { response, payload } = await call(db, "POST", "activity", {
    type: "completed_work",
    userId: "someone-else",
    mangaId: "mt:work",
  });

  assert.equal(response.status, 404);
  assert.equal(payload.error, "NOT_FOUND");
});
