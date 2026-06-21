/*
 * Janson Coffee — hand-rolled Service Worker (Phase-2 · P2-S0).
 *
 * Workbox-free, ~$0, no dependency. It precaches the app shell, serves
 * content-hashed build assets cache-first, navigations stale-while-revalidate,
 * and live Supabase data network-first — and NEVER caches a non-GET (a queued
 * command replay must always reach the server).
 *
 * The routing DECISION mirrors `src/lib/offline/sw-strategy.ts` (a SW can't
 * import a bundled module). That module is unit-tested in node; keep the two in
 * sync. The cache version is bumped per release so a new deploy purges the old
 * shell on `activate` — the cache-bust that defeats the "stale chunk → white
 * screen" footgun.
 */

const CACHE_VERSION = "janson-v1";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE = `${CACHE_VERSION}-precache`;

// Minimal install-time shell. Content-hashed `_next/static` chunks are picked up
// lazily (runtime cache) the first time they're requested — listing them here
// would couple the SW to a specific build's filenames.
const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/favicon.svg"];

// ── strategy (mirror of sw-strategy.ts) ──
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/favicon.svg" ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico)$/.test(pathname)
  );
}
function isApiOrAuth(u) {
  return (
    u.hostname.endsWith(".supabase.co") ||
    u.pathname.startsWith("/rest/v1/") ||
    u.pathname.startsWith("/auth/")
  );
}
function chooseStrategy(method, u) {
  if (method.toUpperCase() !== "GET") return "network-only";
  if (isApiOrAuth(u)) return "network-first";
  if (isStaticAsset(u.pathname)) return "cache-first";
  return "stale-while-revalidate";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Purge every cache that isn't this version — the deploy-time cache-bust.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached); // offline → fall back to whatever we have.
  return cached || network;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  let u;
  try {
    u = new URL(request.url);
  } catch {
    return; // unparseable — let the browser handle it.
  }

  const strategy = chooseStrategy(request.method, u);
  if (strategy === "network-only") return; // writes: don't intercept at all.

  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(request));
  } else if (strategy === "network-first") {
    event.respondWith(networkFirst(request));
  } else {
    // stale-while-revalidate, with an offline navigation fallback to the shell.
    event.respondWith(
      staleWhileRevalidate(request).then(
        (r) => r || caches.match("/"),
      ),
    );
  }
});

// Let the page tell a waiting SW to take over immediately (used on update).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
