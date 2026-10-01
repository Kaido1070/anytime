import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/source/image.js";

function fakeDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { user_id: "u1" };
            },
          };
        },
      };
    },
  };
}

test("Azora image proxy retries an external CDN with its own Referer", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      referer: options.headers?.Referer ?? options.headers?.referer ?? "",
    });

    if (calls.length === 1) {
      return new Response("forbidden", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": "3",
      },
    });
  };

  try {
    const request = new Request(
      "https://wany.site/api/source/image?source=azora" +
        "&url=" +
        encodeURIComponent("https://cdn.example.com/overgeared/190/008.webp") +
        "&referer=" +
        encodeURIComponent("https://azorafly.com/series/overgeared-12/chapter-190"),
      {
        headers: { Cookie: "anytime_session=test-session" },
      },
    );

    const response = await onRequest({
      request,
      env: { DB: fakeDb() },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].referer,
      "https://azorafly.com/series/overgeared-12/chapter-190",
    );
    assert.equal(calls[1].referer, "https://cdn.example.com/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Azora image proxy falls back to no Referer after two rejected attempts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push(options.headers?.Referer ?? options.headers?.referer ?? "");

    if (calls.length < 3) {
      return new Response("blocked", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response(new Uint8Array([9]), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  };

  try {
    const request = new Request(
      "https://wany.site/api/source/image?source=azora" +
        "&url=" +
        encodeURIComponent("https://cdn.example.com/overgeared/190/009.jpg") +
        "&referer=" +
        encodeURIComponent("https://azorafly.com/series/overgeared-12/chapter-190"),
      {
        headers: { Cookie: "anytime_session=test-session" },
      },
    );

    const response = await onRequest({
      request,
      env: { DB: fakeDb() },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://azorafly.com/series/overgeared-12/chapter-190",
      "https://cdn.example.com/",
      "",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
