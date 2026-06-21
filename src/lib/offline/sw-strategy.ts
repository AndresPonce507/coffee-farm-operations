/**
 * Pure Service-Worker routing decisions (P2-S0).
 *
 * The SW (`public/sw.js`) is hand-rolled (Workbox-free, $0, lean). Its caching
 * STRATEGY — the part with real branching and the classic footguns — lives here
 * as pure functions so it is tested in node, separate from the fetch/cache
 * plumbing. `public/sw.js` mirrors this logic (a SW can't `import` a bundled
 * module). Keep the two in sync; this file is the spec the test pins.
 *
 * The footguns it guards against (per the spec's highest-risk note):
 *   - serving a STALE app chunk after a deploy → white screen. Content-hashed
 *     `_next/static` assets are cache-first and immutable, so a new build's new
 *     filenames simply miss-and-fetch; the old cache is purged on activate.
 *   - caching a WRITE. Any non-GET is network-only — a queued command replay
 *     must reach the server, never be served from cache.
 *   - serving stale DATA. Supabase REST/auth is network-first.
 */

export type Strategy =
  | "network-only" // writes + anything that must never be cached.
  | "cache-first" // immutable, content-hashed build assets.
  | "stale-while-revalidate" // the app shell / navigations — instant, refresh behind.
  | "network-first"; // live data (Supabase REST, auth) — fresh wins, cache is the fallback.

/** True for content-hashed, immutable build output + the static shell files. */
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/favicon.svg" ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico)$/.test(pathname)
  );
}

/** True for live-data round-trips that must prefer the network. */
function isApiOrAuth(u: URL): boolean {
  return (
    u.hostname.endsWith(".supabase.co") ||
    u.pathname.startsWith("/rest/v1/") ||
    u.pathname.startsWith("/auth/")
  );
}

/** Decide how to serve a request. `method` is the HTTP verb; `u` the parsed URL. */
export function chooseStrategy(method: string, u: URL): Strategy {
  if (method.toUpperCase() !== "GET") return "network-only";
  if (isApiOrAuth(u)) return "network-first";
  if (isStaticAsset(u.pathname)) return "cache-first";
  // Everything else GET = a navigation / RSC document → serve the shell fast.
  return "stale-while-revalidate";
}

/** Same-origin, non-API path eligible for install-time precache. */
export function isPrecachable(path: string): boolean {
  // Reject absolute URLs (cross-origin) and API paths outright.
  if (/^https?:\/\//.test(path)) return false;
  if (path.startsWith("/rest/v1/") || path.startsWith("/auth/")) return false;
  return path.startsWith("/");
}
