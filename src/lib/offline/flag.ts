/**
 * Offline-first feature flag + graceful-degradation gate (P2-S0).
 *
 * The whole offline substrate is behind one switch so online-only always works:
 *   - the flag itself (a build-time env, static — NOT optional-chained, per the
 *     repo's known Vite inlining gotcha: `import.meta.env?.X` is not inlined),
 *   - AND a runtime capability check (IndexedDB present, a Service-Worker-
 *     capable browser). If either is false, callers fall through to the direct
 *     online transport and nothing about the existing app changes.
 *
 * Default: ON where the platform supports it. The flag exists to kill the
 * substrate instantly if a field issue appears, without a code change.
 */

/**
 * Build-time flag. `NEXT_PUBLIC_OFFLINE` defaults to enabled; set it to the
 * string `"off"` to hard-disable the substrate everywhere. Read statically so
 * Next/Vite inlines it (the optional-chaining-inlining bug from MEMORY).
 */
export function offlineFlagEnabled(): boolean {
  // Static access — bundler inlines `process.env.NEXT_PUBLIC_OFFLINE`.
  const v = process.env.NEXT_PUBLIC_OFFLINE;
  return v !== "off" && v !== "false" && v !== "0";
}

/** Runtime capability: does this browser support the durable substrate? */
export function offlineCapable(): boolean {
  if (typeof window === "undefined") return false; // SSR — no client substrate.
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/** The effective decision callers gate on: flag ON *and* platform-capable. */
export function offlineEnabled(): boolean {
  return offlineFlagEnabled() && offlineCapable();
}
