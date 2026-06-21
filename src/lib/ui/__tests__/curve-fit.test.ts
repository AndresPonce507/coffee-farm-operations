import { describe, expect, it } from "vitest";

import {
  projectCutPoint,
  type FermentPhPoint,
} from "@/lib/ui/curve-fit";

/**
 * Pure-domain test for the cut-point projection (the P2-S3 de-risked v1 model: a
 * simple target-threshold crossing on the live pH curve vs the recipe target). No
 * DB — this mirrors the `v_ferment_cutpoint` SQL view's logic on the client so the
 * UI can project the window-close marker without a round-trip. The logged readings
 * are the durable asset; a better projection is Phase-4 ML.
 */

const series = (...phs: Array<[number, number]>): FermentPhPoint[] =>
  phs.map(([hours, ph]) => ({ hoursElapsed: hours, ph }));

describe("projectCutPoint", () => {
  it("reports no cut and no projection when there are no readings", () => {
    const r = projectCutPoint([], 4.2);
    expect(r.cutReached).toBe(false);
    expect(r.latestPh).toBeNull();
    expect(r.projectedHours).toBeNull();
  });

  it("reports no cut while the latest pH is above the recipe target", () => {
    const r = projectCutPoint(series([0, 5.6], [2, 5.0]), 4.2);
    expect(r.cutReached).toBe(false);
    expect(r.latestPh).toBeCloseTo(5.0, 6);
  });

  it("signals cut once the latest pH reaches/crosses the target (≤ target)", () => {
    const r = projectCutPoint(series([0, 5.6], [4, 4.1]), 4.2);
    expect(r.cutReached).toBe(true);
    expect(r.latestPh).toBeCloseTo(4.1, 6);
    // Already crossed — the projected window-close is now (0 hours away).
    expect(r.projectedHours).not.toBeNull();
    expect(r.projectedHours!).toBeLessThanOrEqual(4);
  });

  it("projects the window-close time by extrapolating the recent pH slope", () => {
    // pH falls 0.5/hour: 5.2 at h2, 4.7 at h3 → target 4.2 reached one more hour out.
    const r = projectCutPoint(series([2, 5.2], [3, 4.7]), 4.2);
    expect(r.cutReached).toBe(false);
    expect(r.projectedHours).not.toBeNull();
    expect(r.projectedHours!).toBeCloseTo(4, 1); // ~h4
  });

  it("returns no projection when the target is unknown (no bound recipe)", () => {
    const r = projectCutPoint(series([0, 5.6], [2, 5.0]), null);
    expect(r.cutReached).toBe(false);
    expect(r.projectedHours).toBeNull();
    // still surfaces the latest reading for the live curve
    expect(r.latestPh).toBeCloseTo(5.0, 6);
  });

  it("does not project backward when the pH is flat or rising (no monotone fall)", () => {
    const flat = projectCutPoint(series([0, 5.0], [2, 5.0]), 4.2);
    expect(flat.cutReached).toBe(false);
    expect(flat.projectedHours).toBeNull();

    const rising = projectCutPoint(series([0, 4.8], [2, 5.1]), 4.2);
    expect(rising.cutReached).toBe(false);
    expect(rising.projectedHours).toBeNull();
  });

  it("uses the chronologically latest reading as 'latest' regardless of input order", () => {
    const r = projectCutPoint(series([4, 4.1], [0, 5.6], [2, 5.0]), 4.2);
    // latest by hoursElapsed is h4 / 4.1 → cut reached
    expect(r.cutReached).toBe(true);
    expect(r.latestPh).toBeCloseTo(4.1, 6);
  });
});
