import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { RIPPLE } from "@/lib/revalidate";

/**
 * F-A guard (build-plan §3 F-A / §8 `ripple-routes-exist`) — the load-bearing one.
 *
 * Every route string in the RIPPLE map must resolve to a REAL App-Router
 * `src/app/(app)/**` `page.tsx` on disk. RIPPLE is the SSOT a Server Action calls
 * to bust every downstream tab after a write (propagation invariant #5). If a tab
 * is later renamed or removed without updating RIPPLE, `revalidatePath` would
 * silently target a dead path and the downstream consumer would quietly go stale.
 * This static guard turns that drift into a RED test instead of invisible rot — so
 * the reactive-refresh contract can never point at a route that no longer ships.
 *
 * Resolution rule (App Router): routes live under the `(app)` route group, which is
 * URL-transparent. The Dashboard `"/"` maps to `(app)/page.tsx`; every other
 * `"/<seg>/<seg>…"` maps to `(app)/<seg>/<seg>…/page.tsx`.
 */

// src/lib/__tests__/ -> repo root is three levels up.
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, "..", "..", "app", "(app)");

/** Map a RIPPLE route to its expected App-Router `page.tsx` path on disk. */
function pageFileForRoute(route: string): string {
  const segments = route.split("/").filter(Boolean); // "/" -> [], "/qc" -> ["qc"]
  return join(APP_DIR, ...segments, "page.tsx");
}

// The distinct route strings across every RIPPLE event (a route appears in several
// rows; dedupe so the guard reports each missing route once).
const allRoutes = [...new Set(Object.values(RIPPLE).flat())].sort();

describe("ripple-routes-exist — every RIPPLE route is a real page.tsx", () => {
  it("the `(app)` route-group directory exists (resolution anchor is valid)", () => {
    // If this fails the path math is wrong, not the routes — fail loudly rather than
    // letting every route assertion below pass against a non-existent anchor.
    expect(existsSync(APP_DIR), `expected (app) route group at ${APP_DIR}`).toBe(true);
  });

  it.each(allRoutes)(
    "route %s resolves to an existing src/app/(app)/**/page.tsx",
    (route) => {
      const file = pageFileForRoute(route);
      expect(
        existsSync(file),
        `RIPPLE route "${route}" has no page.tsx (looked for ${file}). ` +
          "A renamed/removed tab must update src/lib/revalidate.ts so no " +
          "downstream consumer is silently dropped.",
      ).toBe(true);
    },
  );

  it("covers every route in the map (the census is non-empty and complete)", () => {
    // Guardrail discipline (global Rule 5): prove the guard actually EXERCISES the
    // map — a guard that silently iterates nothing is itself an incident.
    expect(allRoutes.length).toBeGreaterThan(0);
    const fromMap = new Set(Object.values(RIPPLE).flat());
    expect(new Set(allRoutes)).toEqual(fromMap);
  });
});
