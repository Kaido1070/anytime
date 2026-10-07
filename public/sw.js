const CACHE = "anytime-shell-v3";
const PRECACHE = [];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("anytime-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    const archivedCover = url.pathname === "/api/work-snapshots/cover" && Boolean(url.searchParams.get("v"));
    // Only the browser's private HTTP cache stores authenticated cover bytes.
    // Session/progress/account JSON never enters the shared shell CacheStorage.
    event.respondWith(fetch(event.request, { cache: archivedCover ? "default" : "no-store" }));
    return;
  }

  const isNavigation = event.request.mode === "navigate";
  if (isNavigation) {
    // The installed worker's shell and hashed assets belong to the same build.
    // The normal registration update installs a complete new build atomically.
    event.respondWith(
      caches.open(CACHE).then(async (cache) =>
        (await cache.match("/")) || fetch(event.request, { cache: "no-store" }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && (PRECACHE.includes(url.pathname) || url.pathname.startsWith("/assets/"))) {
        event.waitUntil(cache.put(event.request, response.clone()));
      }
      return response;
    }),
  );
});
