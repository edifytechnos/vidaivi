// Vidai's service worker. It exists so the app can be installed, and it does
// as little as it can get away with — on purpose.
//
// It handles NAVIGATIONS and nothing else: the page itself is always fetched
// from the network, exactly as it is without a worker, and only when the
// network is not there at all does it answer with a small offline page. It
// never caches index.html (a cached shell would pin a tab to an old build —
// the very thing src/staleload.ts and scripts/carry-assets.sh exist to undo),
// never touches /assets/ (already immutable in the HTTP cache) and never
// touches /api/ (a cached answer is a wrong answer). Requests it does not
// handle go to the network as if it were not installed.

const CACHE = "vidai-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Navigation preload starts the page's request while the worker boots,
      // so having a worker costs a navigation nothing on a slow phone.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        return (await caches.match(OFFLINE)) || Response.error();
      }
    })()
  );
});
