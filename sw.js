/* Poker Banting service worker.
 *
 * Strategy (the app is a small static shell over a live WebSocket API):
 *  - App shell (html/js/manifest/icons): cache-first with background
 *    refresh (stale-while-revalidate). The shell is versioned by the
 *    browser via CACHE_VERSION below; bump it on every release so the
 *    new shell replaces the old one on next load.
 *  - Everything under /api (REST + the /api/ws upgrade path): network
 *    only, NEVER cached. The game is live state — caching it would serve
 *    stale boards and break rejoin semantics.
 *  - Navigations: network-first, falling back to the cached shell so the
 *    app still opens offline (it can't play without the server, but the
 *    lobby renders and the "Connected" pill shows the truth).
 *
 * NOTE: WebSocket frames never go through fetch(), so the SW never sees
 * or touches the game traffic — it only handles the shell + /api REST.
 */

const CACHE_VERSION = "pb-v4"; // bump on every release (v4: PWA standalone no-scroll fix — 100% instead of 100dvh)
const STATIC_CACHE = `pb-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pb-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/src/app.js",
  "/src/game.js",
  "/src/network.js",
  "/src/render.js",
  "/src/session.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("pb-") && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let CORS cross-origin traffic pass

  // Live game API: never cache, never intercept the WS upgrade.
  if (url.pathname.startsWith("/api")) return;

  // Navigations: network-first, fallback to the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put("/index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("/index.html");
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate. On an offline miss the
  // precached shell (STATIC_CACHE) is the fallback — the first page load
  // happens before the SW takes control, so RUNTIME_CACHE may be empty.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && (res.type === "basic" || res.type === "cors")) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      if (cached) {
        return cached; // serve instantly; refresh in background
      }
      const fresh = await network;
      if (fresh) return fresh;
      return (await caches.match(req, { cacheName: STATIC_CACHE }))
        || (await caches.match(req, { cacheName: RUNTIME_CACHE }))
        || Response.error();
    })()
  );
});
