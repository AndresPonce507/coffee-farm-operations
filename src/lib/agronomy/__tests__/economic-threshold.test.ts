import { describe, expect, it } from "vitest";

import {
  BROCA_ACTION_THRESHOLD_PCT,
  evaluateThreshold,
  ROYA_ACTION_THRESHOLD_PCT,
  thresholdFor,
} from "@/lib/agronomy/economic-threshold";

/**
 * Pure-domain test for the IPM economic-threshold engine (P2-S12). A scouting
 * observation of pest incidence is compared to the published economic-action
 * threshold for that pest (broca / roya): at-or-above → recommend control, below
 * → hold (an unnecessary spray costs money AND burns the PHI/REI/cert budget).
 * This is the engine the SQL `v_ipm_threshold` view mirrors; keeping it a pure
 * function makes the recommend/hold call exhaustively testable and identical in
 * the UI and the DB.
 */

describe("thresholdFor — published per-pest action thresholds", () => {
  it("knows the broca (coffee borer) economic threshold", () => {
    expect(thresholdFor("broca")).toBe(BROCA_ACTION_THRESHOLD_PCT);
  });

  it("knows the roya (leaf rust) economic threshold", () => {
    expect(thresholdFor("roya")).toBe(ROYA_ACTION_THRESHOLD_PCT);
  });

  it("returns null for an unknown pest (no fabricated threshold)", () => {
    expect(thresholdFor("unknown-pest")).toBeNull();
  });
});

describe("evaluateThreshold — recommend vs hold", () => {
  it("recommends control when incidence is ABOVE the broca threshold", () => {
    const r = evaluateThreshold("broca", BROCA_ACTION_THRESHOLD_PCT + 2);
    expect(r.recommend).toBe(true);
    expect(r.threshold).toBe(BROCA_ACTION_THRESHOLD_PCT);
    expect(r.exceedance).toBeGreaterThan(0);
  });

  it("recommends control AT the threshold (>= is the action boundary)", () => {
    const r = evaluateThreshold("broca", BROCA_ACTION_THRESHOLD_PCT);
    expect(r.recommend).toBe(true);
    expect(r.exceedance).toBe(0);
  });

  it("holds (does NOT recommend) when incidence is below the threshold", () => {
    const r = evaluateThreshold("roya", ROYA_ACTION_THRESHOLD_PCT - 1);
    expect(r.recommend).toBe(false);
    expect(r.exceedance).toBeLessThan(0);
  });

  it("for an unknown pest it cannot recommend (no threshold to act on) and says so", () => {
    const r = evaluateThreshold("mystery-bug", 99);
    expect(r.recommend).toBe(false);
    expect(r.threshold).toBeNull();
  });

  it("treats a higher incidence as a higher-priority recommendation (exceedance grows)", () => {
    const mild = evaluateThreshold("broca", BROCA_ACTION_THRESHOLD_PCT + 1);
    const severe = evaluateThreshold("broca", BROCA_ACTION_THRESHOLD_PCT + 20);
    expect(severe.exceedance).toBeGreaterThan(mild.exceedance);
    expect(severe.priority).toBe("high");
    expect(mild.priority).not.toBe("high");
  });
});
