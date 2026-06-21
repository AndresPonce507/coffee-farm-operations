/**
 * Tear down all client-side offline state. Called on sign-out so a shared or
 * field device cannot serve the previous session's cached (PII / payroll / EUDR)
 * pages back out of the Service Worker runtime cache.
 *
 * Security fix — 2026-06-21 audit, finding "SW caches authenticated pages and
 * never purges on sign-out (session-boundary leak)". The SW caches HTML
 * navigations stale-while-revalidate, so without this the next person on the
 * tablet sees the prior user's rendered payroll/identity pages.
 *
 * Best-effort and safe to call anywhere: it no-ops when the Cache Storage /
 * Service Worker APIs are unavailable (SSR, older browsers, tests).
 */
export async function purgeOfflineCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // best-effort: never block sign-out on cache teardown
  }

  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.serviceWorker &&
      typeof navigator.serviceWorker.getRegistrations === "function"
    ) {
      const registrations =
        await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch {
    // best-effort
  }
}
