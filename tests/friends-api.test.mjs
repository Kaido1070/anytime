import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalFriendPair,
  onRequest,
} from "../functions/api/[[path]].js";

const users = {
  a: { id: "a", username: "alpha", name: "Alpha", profile_visibility: "public" },
  b: { id: "b", username: "bravo", name: "Bravo", profile_visibility: "private" },
  c: { id: "c", username: "charlie", name: "Charlie", profile_visibility: "public" },
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
    if (this.query.includes("SELECT value FROM schema_meta")) {
      return { value: "20" };
    }

    if (this.query.includes("FROM sessions s") && this.query.includes("JOIN users u")) {
      const actor = this.db.users[this.db.actor];
      if (!actor) return null;
      return {
        token_hash: "test-token-hash",
        user_id: actor.id,
        expires_at: Date.now() + 60_000,
        last_seen_at: Date.now(),
        ...actor,
      };
    }

    if (this.query.includes("SELECT id, username, name, profile_visibility, avatar_id FROM users WHERE id = ?")) {
      return this.db.users[this.args[0]] ?? null;
    }

    if (this.query.includes("SELECT id, username, name, profile_visibility, avatar_id FROM users WHERE username = ?")) {
      return (
        Object.values(this.db.users).find((user) => user.username === this.args[0]) ?? null
      );
    }

    if (this.query.includes("SELECT id FROM users WHERE id = ?")) {
      const user = this.db.users[this.args[0]];
      return user ? { id: user.id } : null;
    }

    if (
      this.query.includes("FROM friendships") &&
      this.query.includes("(user_id = ? AND friend_id = ?)")
    ) {
      const [firstUser, firstFriend, secondUser, secondFriend] = this.args;
      if (
        this.db.friendships.has(`${firstUser}:${firstFriend}`) ||
        this.db.friendships.has(`${secondUser}:${secondFriend}`)
      ) {
        return { user_id: firstUser, friend_id: firstFriend };
      }
      return null;
    }

    if (
      this.query.includes("FROM friend_requests") &&
      this.query.includes("pair_low_id = ?") &&
      this.query.includes("LIMIT 1")
    ) {
      const [low, high] = this.args;
      return this.db.requests.get(`${low}:${high}`) ?? null;
    }

    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    if (this.query.includes("INSERT OR IGNORE INTO friend_requests")) {
      const [low, high, requester, receiver] = this.args;
      const key = `${low}:${high}`;
      const alreadyFriends =
        this.db.friendships.has(`${requester}:${receiver}`) ||
        this.db.friendships.has(`${receiver}:${requester}`);
      if (alreadyFriends || this.db.requests.has(key)) {
        return { meta: { changes: 0 } };
      }
      this.db.requests.set(key, {
        pair_low_id: low,
        pair_high_id: high,
        requester_id: requester,
        receiver_id: receiver,
        created_at: this.args[4],
      });
      return { meta: { changes: 1 } };
    }

    if (
      this.query.includes("INSERT OR IGNORE INTO friendships") &&
      this.query.includes("FROM friend_requests")
    ) {
      const [, low, high, requester, receiver] = this.args;
      const request = this.db.requests.get(`${low}:${high}`);
      if (
        !request ||
        request.requester_id !== requester ||
        request.receiver_id !== receiver
      ) {
        return { meta: { changes: 0 } };
      }

      const pair = this.query.includes("SELECT receiver_id, requester_id")
        ? `${receiver}:${requester}`
        : `${requester}:${receiver}`;
      const before = this.db.friendships.size;
      this.db.friendships.add(pair);
      return { meta: { changes: this.db.friendships.size > before ? 1 : 0 } };
    }

    if (this.query.includes("DELETE FROM friend_requests")) {
      const [low, high] = this.args;
      const key = `${low}:${high}`;
      const request = this.db.requests.get(key);
      if (!request) return { meta: { changes: 0 } };

      if (this.args.length >= 4) {
        const requester = this.args[2];
        const receiver = this.args[3];
        if (
          request.requester_id !== requester ||
          request.receiver_id !== receiver
        ) {
          return { meta: { changes: 0 } };
        }
      }

      this.db.requests.delete(key);
      return { meta: { changes: 1 } };
    }

    if (this.query.includes("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?")) {
      const key = `${this.args[0]}:${this.args[1]}`;
      const deleted = this.db.friendships.delete(key);
      return { meta: { changes: deleted ? 1 : 0 } };
    }

    return { meta: { changes: 1 } };
  }
}

class FakeDb {
  constructor() {
    this.users = structuredClone(users);
    this.actor = "a";
    this.requests = new Map();
    this.friendships = new Set();
  }

  prepare(query) {
    return new FakeStatement(this, query);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

async function call(db, actor, method, path, body) {
  db.actor = actor;
  const request = new Request(`https://wany.test/api/${path}`, {
    method,
    headers: {
      Origin: "https://wany.test",
      Cookie: "anytime_session=test-session",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await onRequest({ request, env: { DB: db } });
  const payload = await response.json();
  return { response, payload };
}

test("canonical pair is identical in both directions", () => {
  assert.deepEqual(canonicalFriendPair("a", "b"), ["a", "b"]);
  assert.deepEqual(canonicalFriendPair("b", "a"), ["a", "b"]);
});

test("send creates one pending request and reverse send becomes pending_received", async () => {
  const db = new FakeDb();

  const first = await call(db, "a", "POST", "friends", { userId: "b" });
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.relationship, "pending_sent");
  assert.equal(db.requests.size, 1);

  const duplicate = await call(db, "a", "POST", "friends", { userId: "b" });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.relationship, "pending_sent");
  assert.equal(db.requests.size, 1);

  const reverse = await call(db, "b", "POST", "friends", { userId: "a" });
  assert.equal(reverse.response.status, 200);
  assert.equal(reverse.payload.relationship, "pending_received");
  assert.equal(db.requests.size, 1);
});

test("receiver accepts atomically into symmetric friendship", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });

  const accepted = await call(db, "b", "POST", "friends/requests/a/accept");
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.relationship, "friends");
  assert.equal(db.requests.size, 0);
  assert.equal(db.friendships.has("a:b"), true);
  assert.equal(db.friendships.has("b:a"), true);
});

test("receiver can reject and sender can send again later", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });

  const rejected = await call(db, "b", "POST", "friends/requests/a/reject");
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.payload.relationship, "none");
  assert.equal(db.requests.size, 0);

  const resent = await call(db, "a", "POST", "friends", { userId: "b" });
  assert.equal(resent.response.status, 201);
  assert.equal(resent.payload.relationship, "pending_sent");
});

test("only sender can cancel a pending request", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });

  const wrongSide = await call(db, "b", "DELETE", "friends/requests/a");
  assert.equal(wrongSide.response.status, 403);
  assert.equal(wrongSide.payload.error, "NOT_REQUEST_SENDER");
  assert.equal(db.requests.size, 1);

  const canceled = await call(db, "a", "DELETE", "friends/requests/b");
  assert.equal(canceled.response.status, 200);
  assert.equal(canceled.payload.relationship, "none");
  assert.equal(db.requests.size, 0);
});

test("self friend requests are rejected by backend", async () => {
  const db = new FakeDb();
  const result = await call(db, "a", "POST", "friends", { userId: "a" });

  assert.equal(result.response.status, 400);
  assert.equal(result.payload.error, "SELF_FRIEND_REQUEST");
  assert.equal(db.requests.size, 0);
});

test("third user cannot accept or cancel another pair's request", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });

  const accept = await call(db, "c", "POST", "friends/requests/a/accept");
  assert.equal(accept.response.status, 404);
  assert.equal(db.requests.size, 1);

  const cancel = await call(db, "c", "DELETE", "friends/requests/b");
  assert.equal(cancel.response.status, 404);
  assert.equal(db.requests.size, 1);
  assert.equal(db.friendships.size, 0);
});

test("either accepted friend can remove friendship without touching other data", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });
  await call(db, "b", "POST", "friends/requests/a/accept");

  const removed = await call(db, "a", "DELETE", "friends/b");
  assert.equal(removed.response.status, 200);
  assert.equal(removed.payload.relationship, "none");
  assert.equal(db.friendships.has("a:b"), false);
  assert.equal(db.friendships.has("b:a"), false);

  const resend = await call(db, "b", "POST", "friends", { userId: "a" });
  assert.equal(resend.response.status, 201);
  assert.equal(resend.payload.relationship, "pending_sent");
});

test("third user cannot remove another pair's friendship", async () => {
  const db = new FakeDb();
  await call(db, "a", "POST", "friends", { userId: "b" });
  await call(db, "b", "POST", "friends/requests/a/accept");

  const result = await call(db, "c", "DELETE", "friends/b");
  assert.equal(result.response.status, 404);
  assert.equal(db.friendships.has("a:b"), true);
  assert.equal(db.friendships.has("b:a"), true);
});
