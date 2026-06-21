import { describe, expect, it } from "vitest";

import {
  accumulateGdd,
  dailyGdd,
  GEISHA_BLOOM_TO_CHERRY_GDD,
  predictReadyDate,
  rankByReadiness,
  readinessScore,
  staggerOffsetDays,
  type ReadinessInput,
} from "@/lib/agronomy/gdd";

// ── dailyGdd: single-day growing-degree-days, base 10°C, capped at 30°C ───────
describe("dailyGdd — single-day growing-degree-days (base 10°C)", () => {
  it("is the mean of hi/lo minus the 10°C base", () => {
    // mean = (24+14)/2 = 19 ; 19 - 10 = 9
    expect(dailyGdd(24, 14)).toBe(9);
  });

  it("never goes negative when the mean is below the base (a cold day adds 0)", () => {
    // mean = (8+2)/2 = 5 ; below base 10 -> clamped to 0, never a negative GDD
    expect(dailyGdd(8, 2)).toBe(0);
  });

  it("caps the daily contribution using a 30°C upper threshold", () => {
    // a 40°C hi is treated as 30 for the mean: (30+20)/2 = 25 ; 25 - 10 = 15
    expect(dailyGdd(40, 20)).toBe(15);
  });
});

// ── accumulateGdd: sum a series of daily hi/lo into accumulated GDD ────────────
describe("accumulateGdd — accumulate a daily temperature series", () => {
  it("sums dailyGdd across the series", () => {
    // day1: (24,14)->mean 19->9 ; day2: (22,12)->mean 17->7 ; day3 cold (8,2)->0  => 16
    const series = [
      { hi: 24, lo: 14 },
      { hi: 22, lo: 12 },
      { hi: 8, lo: 2 },
    ];
    expect(accumulateGdd(series)).toBe(16);
  });

  it("is 0 for an empty series (no data, not a guess)", () => {
    expect(accumulateGdd([])).toBe(0);
  });
});

// ── staggerOffsetDays: the altitude gradient staggers the harvest ─────────────
describe("staggerOffsetDays — altitude staggers ripening (lower ripens first)", () => {
  it("is 0 at the bottom of the 1360–1700 masl gradient", () => {
    expect(staggerOffsetDays(1360)).toBe(0);
  });

  it("grows with altitude — a higher plot ripens later", () => {
    expect(staggerOffsetDays(1700)).toBeGreaterThan(staggerOffsetDays(1360));
  });

  it("is monotonic up the gradient (a strictly later pick the higher you go)", () => {
    expect(staggerOffsetDays(1700)).toBeGreaterThan(staggerOffsetDays(1500));
    expect(staggerOffsetDays(1500)).toBeGreaterThan(staggerOffsetDays(1400));
  });

  it("clamps below the gradient floor to 0 (never negative)", () => {
    expect(staggerOffsetDays(1200)).toBe(0);
  });
});

// ── predictReadyDate: bloom + GDD-to-cherry, staggered by altitude ────────────
describe("predictReadyDate — bloom date + GDD phenology + altitude stagger", () => {
  it("projects later for a higher plot than a lower plot bloomed the same day", () => {
    const bloom = "2026-01-01";
    const low = predictReadyDate(bloom, 50, 1360, 12); // 50 GDD/day accrual
    const high = predictReadyDate(bloom, 50, 1700, 12);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(new Date(high as string).getTime()).toBeGreaterThan(
      new Date(low as string).getTime(),
    );
  });

  it("returns null when there is no bloom date (honest unknown, not a fabricated date)", () => {
    expect(predictReadyDate(null, 50, 1500, 12)).toBeNull();
  });

  it("returns null when the GDD/day accrual is non-positive (can't divide by 0)", () => {
    expect(predictReadyDate("2026-01-01", 0, 1500, 12)).toBeNull();
  });
});

// ── readinessScore: derived [0..1], never a typed flag ────────────────────────
describe("readinessScore — DERIVED readiness in [0,1], never a hand-set flag", () => {
  const base: ReadinessInput = {
    gddAccumulated: GEISHA_BLOOM_TO_CHERRY_GDD,
    gddToCherry: GEISHA_BLOOM_TO_CHERRY_GDD,
    altitudeMasl: 1360,
    ndviLatest: null,
    recentRipenessPct: null,
  };

  it("is 1 when accumulated GDD has met the bloom→cherry requirement at the gradient floor", () => {
    expect(readinessScore(base)).toBeCloseTo(1, 5);
  });

  it("is below 1 when accumulated GDD is short of the requirement", () => {
    expect(
      readinessScore({ ...base, gddAccumulated: GEISHA_BLOOM_TO_CHERRY_GDD / 2 }),
    ).toBeLessThan(1);
  });

  it("is clamped to [0,1] even when GDD overshoots the requirement", () => {
    const s = readinessScore({
      ...base,
      gddAccumulated: GEISHA_BLOOM_TO_CHERRY_GDD * 3,
    });
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("is 0 with no GDD signal at all (no data → not ready, never a default 'ready')", () => {
    expect(readinessScore({ ...base, gddAccumulated: 0 })).toBe(0);
  });

  it("blends a high NDVI upward and a low NDVI downward vs the GDD-only score", () => {
    const half = { ...base, gddAccumulated: GEISHA_BLOOM_TO_CHERRY_GDD / 2 };
    const gddOnly = readinessScore(half);
    const greener = readinessScore({ ...half, ndviLatest: 0.85 });
    const sparser = readinessScore({ ...half, ndviLatest: 0.2 });
    expect(greener).toBeGreaterThan(gddOnly);
    expect(sparser).toBeLessThan(gddOnly);
  });
});

// ── rankByReadiness: the ordering the dispatch card reads ─────────────────────
describe("rankByReadiness — most-ready-first, the dispatch input", () => {
  const mk = (score: number): ReadinessInput => ({
    // a ReadinessInput whose readinessScore is exactly `score`
    gddAccumulated: GEISHA_BLOOM_TO_CHERRY_GDD * score,
    gddToCherry: GEISHA_BLOOM_TO_CHERRY_GDD,
    altitudeMasl: 1360,
    ndviLatest: null,
    recentRipenessPct: null,
  });

  it("orders plots by descending readiness score", () => {
    const ranked = rankByReadiness([
      { plotId: "p-high", ...mk(0.3) },
      { plotId: "p-low", ...mk(0.95) },
      { plotId: "p-mid", ...mk(0.6) },
    ]);
    expect(ranked.map((r) => r.plotId)).toEqual(["p-low", "p-mid", "p-high"]);
  });

  it("is a pure sort — does not mutate the input array", () => {
    const input = [
      { plotId: "a", ...mk(0.1) },
      { plotId: "b", ...mk(0.9) },
    ];
    const before = input.map((i) => i.plotId);
    rankByReadiness(input);
    expect(input.map((i) => i.plotId)).toEqual(before);
  });
});
