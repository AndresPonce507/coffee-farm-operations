import { describe, expect, it } from "vitest";

import {
  CLOUD_OPTICAL_CEILING_PCT,
  fuseVegetation,
  OPTICAL_STALE_DAYS,
  type VegetationObservation,
} from "@/lib/agronomy/confidence-fusion";

/**
 * Pure-domain test for the NDVI/NDRE + Sentinel-1 SAR fusion (P2-S12). The fusion
 * is what makes the satellite layer useful in Volcán's near-daily cloud: when the
 * optical (Sentinel-2) read is cloudy or stale, the cloud-penetrating SAR
 * (Sentinel-1) read carries it — and the badge says so, HONESTLY, never hiding a
 * low-confidence state. This is the SQL `v_plot_vegetation` fusion mirrored as a
 * pure, exhaustively-testable function so the badge and the view always agree.
 */

const ASOF = "2026-06-21T12:00:00Z";

/** A recent, low-cloud optical read — the high-confidence baseline. */
const opticalClear = (over: Partial<VegetationObservation> = {}): VegetationObservation => ({
  source: "sentinel-2",
  indexKind: "ndvi",
  value: 0.78,
  cloudPct: 5,
  observedAt: "2026-06-20T12:00:00Z",
  ...over,
});

/** A SAR backscatter read — cloud-penetrating, always available. */
const sar = (over: Partial<VegetationObservation> = {}): VegetationObservation => ({
  source: "sentinel-1-sar",
  indexKind: "sar-backscatter",
  value: 0.61,
  cloudPct: 0,
  observedAt: "2026-06-20T12:00:00Z",
  ...over,
});

describe("fuseVegetation — honest confidence badge", () => {
  it("a recent low-cloud optical read fuses to HIGH confidence, optical-led", () => {
    const f = fuseVegetation([opticalClear()], ASOF);
    expect(f.confidence).toBe("high");
    expect(f.basis).toBe("optical");
    expect(f.value).toBeCloseTo(0.78, 5);
  });

  it("falls back to SAR with MEDIUM confidence when the optical read is too cloudy", () => {
    const f = fuseVegetation(
      [opticalClear({ cloudPct: CLOUD_OPTICAL_CEILING_PCT + 10 }), sar()],
      ASOF,
    );
    expect(f.basis).toBe("sar");
    expect(f.confidence).toBe("medium");
    expect(f.value).toBeCloseTo(0.61, 5); // the SAR value, not the cloud-blinded optical
  });

  it("falls back to SAR when the optical read is STALE (older than the staleness window)", () => {
    // optical observed well before the staleness horizon, SAR is fresh
    const staleOptical = opticalClear({ observedAt: "2026-05-01T12:00:00Z", cloudPct: 5 });
    const f = fuseVegetation([staleOptical, sar()], ASOF);
    expect(f.basis).toBe("sar");
    expect(f.confidence).toBe("medium");
  });

  it("with ONLY a too-cloudy optical and NO SAR, it is honestly LOW confidence (never hidden)", () => {
    const f = fuseVegetation([opticalClear({ cloudPct: 95 })], ASOF);
    expect(f.confidence).toBe("low");
    // it still returns the optical value (best available) but flags it low
    expect(f.basis).toBe("optical");
  });

  it("with NO observations at all returns a null value at LOW confidence (an honest unknown)", () => {
    const f = fuseVegetation([], ASOF);
    expect(f.value).toBeNull();
    expect(f.confidence).toBe("low");
  });

  it("prefers a CLEAR recent optical over SAR even when both are present (optical is richer)", () => {
    const f = fuseVegetation([opticalClear({ cloudPct: 3 }), sar()], ASOF);
    expect(f.basis).toBe("optical");
    expect(f.confidence).toBe("high");
  });

  it("uses the most-recent observation per source (older reads are ignored)", () => {
    const old = opticalClear({ value: 0.2, observedAt: "2026-06-10T12:00:00Z", cloudPct: 4 });
    const fresh = opticalClear({ value: 0.81, observedAt: "2026-06-20T12:00:00Z", cloudPct: 4 });
    const f = fuseVegetation([old, fresh], ASOF);
    expect(f.value).toBeCloseTo(0.81, 5);
  });

  it("exposes the staleness + cloud thresholds as named constants (transparent, tunable)", () => {
    expect(OPTICAL_STALE_DAYS).toBeGreaterThan(0);
    expect(CLOUD_OPTICAL_CEILING_PCT).toBeGreaterThan(0);
    expect(CLOUD_OPTICAL_CEILING_PCT).toBeLessThanOrEqual(100);
  });
});
