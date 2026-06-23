import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock next/cache's revalidatePath so the unit test observes the route-busting
// without a Next runtime. The mock is hoisted by vitest before the import below.
const revalidatePath = vi.fn();
// Forward EXACTLY the args reactiveRefresh passes (1 arg for static routes, 2 for
// dynamic `[segment]` routes that carry the "page" type) so the spy observes the
// real call shape.
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

import { RIPPLE, reactiveRefresh, type EventKind } from "@/lib/revalidate";

beforeEach(() => revalidatePath.mockClear());

/**
 * Reactive-refresh SSOT (facet-01 §2 propagation contract). slice-01 ships the
 * FULL RIPPLE key set with real route arrays so F-A (L1) only adds the guard test
 * and there is no foundation/skeleton collision on this file. The load-bearing
 * behaviour proven here is the J1 (`weigh-in`) row; the other keys are asserted
 * present + non-empty so a later edit can't silently drop a downstream consumer.
 */
describe("RIPPLE — the per-event downstream route map", () => {
  it("busts the J1 (weigh-in) route set: Weigh + Harvests + Crew + Dashboard", () => {
    reactiveRefresh("weigh-in");
    // every route in the weigh-in row is revalidated, once each.
    for (const route of RIPPLE["weigh-in"]) {
      expect(revalidatePath).toHaveBeenCalledWith(route);
    }
    expect(revalidatePath).toHaveBeenCalledTimes(RIPPLE["weigh-in"].length);
  });

  it("the weigh-in row names BOTH immediate consumers the proof panel links: Dashboard '/' and Harvests", () => {
    // facet-01 §2: a weigh-in ripples to the Dashboard 'today' headline and Harvests.
    expect(RIPPLE["weigh-in"]).toContain("/");
    expect(RIPPLE["weigh-in"]).toContain("/harvests");
  });

  it("includes the cross-tab dossier/board consumers each write actually moves", () => {
    // Round-A review: these downstream surfaces read a view the write moves; a missing
    // one ships a stale number on a dossier/board (PRINCIPLE Rule 3).
    expect(RIPPLE["weigh-in"]).toContain("/workers"); // worker dossier "kg today"
    expect(RIPPLE["cherry-intake"]).toContain("/plots/[id]"); // plot dossier harvests
    expect(RIPPLE["cost-entry"]).toContain("/lots/[code]"); // lot dossier cost provenance
    expect(RIPPLE["plot"]).toContain("/satellite");
    expect(RIPPLE["plot"]).toContain("/plots/[id]");
    expect(RIPPLE["worker"]).toContain("/crew");
    expect(RIPPLE["processing-batch"]).toContain("/drying");
    expect(RIPPLE["disbursement"]).toContain("/lots/[code]");
    expect(RIPPLE["spray"]).toContain("/plots/[id]");
  });

  it("revalidates dynamic-route patterns with the 'page' type (Next 15) and static routes bare", () => {
    // cost-entry mixes static (/costing,/inventory) + dynamic (/lots/[code]). The
    // dynamic one MUST carry "page" or it silently no-ops; the static ones must NOT.
    reactiveRefresh("cost-entry");
    expect(revalidatePath).toHaveBeenCalledWith("/costing");
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/lots/[code]", "page");
    // a bare dynamic call (the old no-op trap) must never happen.
    expect(revalidatePath).not.toHaveBeenCalledWith("/lots/[code]");
  });

  it("ships the full event-kind key set (so F-A only adds the guard, no map fork)", () => {
    const expected: EventKind[] = [
      "weigh-in",
      "cherry-intake",
      "cost-entry",
      "spray",
      "qc-hold",
      "plot",
      "disbursement",
    ];
    for (const k of expected) {
      expect(RIPPLE[k], `RIPPLE missing key "${k}"`).toBeDefined();
      // every event has at least one downstream consumer route.
      expect(RIPPLE[k].length).toBeGreaterThan(0);
    }
  });

  it("every RIPPLE route is an absolute app path (starts with '/')", () => {
    for (const routes of Object.values(RIPPLE)) {
      for (const route of routes) {
        expect(route.startsWith("/")).toBe(true);
      }
    }
  });

  it("reactiveRefresh for a multi-route event busts each route exactly once", () => {
    reactiveRefresh("qc-hold");
    expect(revalidatePath).toHaveBeenCalledTimes(RIPPLE["qc-hold"].length);
    for (const route of RIPPLE["qc-hold"]) {
      expect(revalidatePath).toHaveBeenCalledWith(route);
    }
  });
});
