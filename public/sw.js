/*
 * Janson Coffee — hand-rolled Service Worker (Phase-2 · P2-S0).
 *
 * Workbox-free, ~$0, no dependency. It precaches the app shell, serves
 * content-hashed build assets cache-first, navigations stale-while-revalidate,
 * and live Supabase data network-first — and NEVER caches a non-GET (a queued
 * command replay must always reach the server).
 *
 * The routing DECISION mirrors `src/lib/offline/sw-strategy.ts` (a SW can't
 * import a bundled module). That module is unit-tested in node, and
 * `sw-lifecycle.test.ts` evaluates THIS file to pin the two copies in agreement
 * plus drive the install/activate/message handlers — keep the two in sync.
 *
 * The "stale chunk → white screen" footgun is defeated by the STRATEGY, not the
 * cache version: `_next/static` assets are content-hashed and cache-first, so a
 * new build's new filenames simply miss-and-fetch; navigations are
 * stale-while-revalidate, so the shell self-heals on the next online load.
 * `CACHE_VERSION` is a manual marker that only needs bumping on a BREAKING
 * SW-cache-schema change (a different cache layout the old `activate` purge must
 * evict) — it is NOT auto-injected per deploy, so do not rely on it for routine
 * cache-busting.
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
  // Purge every cache that isn't this version — janitorial cleanup that reclaims
  // a superseded CACHE_VERSION's caches on a breaking SW-cache-schema bump.
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
  // `network-first` is only ever chosen for Supabase REST/auth round-trips
  // (`isApiOrAuth`). Those carry a per-user bearer token in the Authorization
  // HEADER, not the URL — so the request URL alone is NOT a safe cache key:
  // persisting one signed-in user's authenticated body into the shared,
  // sign-out-surviving RUNTIME_CACHE would leak it to the next user of a shared
  // field device. Treat live data as network-only: never write it to a
  // persistent cache, and never serve a stale authenticated body as a fallback.
  return fetch(request);
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

self.addEventListener("message", (event) => {
  // Let the page tell a waiting SW to take over immediately (used on update).
  if (event.data === "SKIP_WAITING") self.skipWaiting();

  // Purge the shared runtime cache on demand — the page posts this on sign-out
  // so the next user of a shared field device can't read the previous user's
  // cached navigation documents (rendered farm/payroll/cost data) out of Cache
  // Storage. Cache keys are URL-only, so without this the cached signed-in shell
  // survives sign-out and is readable offline or via `caches.match()`.
  if (event.data === "CLEAR_DATA_CACHE") {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});
