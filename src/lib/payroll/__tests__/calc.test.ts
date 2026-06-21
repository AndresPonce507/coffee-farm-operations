import { describe, expect, it } from "vitest";

import {
  computePayLine,
  gross,
  makeWhole,
  minWageFloor,
  netPay,
  round2,
  statutoryWithholding,
  type StatutoryRates,
} from "@/lib/payroll/calc";

// The pure mirror of the DB payroll math in
// supabase/migrations/20260622108000_payroll.sql. The DB is the real enforcement
// (generated columns + CHECK + the floor-reasserting trigger); this lib is the
// documented spec + the UI-preview engine, so it must match the SQL EXACTLY.

// ── round2: 2-decimal rounding without float drift ────────────────────────────
describe("round2 — money rounding to 2 decimals, no float drift", () => {
  it("rounds to two decimal places", () => {
    expect(round2(1.005)).toBe(1.01); // the classic float-drift case (1.005 → 1.00 naively)
    expect(round2(2.675)).toBe(2.68);
  });

  it("leaves an already-2dp value unchanged", () => {
    expect(round2(16)).toBe(16);
    expect(round2(9.75)).toBe(9.75);
  });

  it("rounds half up at the 2nd decimal", () => {
    expect(round2(0.125)).toBe(0.13);
  });
});

// ── minWageFloor: round2(hours × rate), clamps negatives to 0 ──────────────────
describe("minWageFloor — the legal floor = round2(hours × min-wage hourly)", () => {
  it("is hours × rate, rounded to cents", () => {
    // mirrors the trigger: round(hours_worked * min_wage_hourly_usd, 2)
    expect(minWageFloor(8, 0.8)).toBe(6.4);
    expect(minWageFloor(10, 1.6)).toBe(16);
  });

  it("is 0 for zero hours", () => {
    expect(minWageFloor(0, 0.8)).toBe(0);
  });

  it("clamps negative hours to 0 (no negative floor)", () => {
    expect(minWageFloor(-5, 0.8)).toBe(0);
  });

  it("clamps a negative rate to 0 (a floor is never negative)", () => {
    expect(minWageFloor(8, -0.8)).toBe(0);
  });

  it("rounds the product to cents (no float tail)", () => {
    // 7.25 * 1.333 = 9.66425 → 9.66
    expect(minWageFloor(7.25, 1.333)).toBe(9.66);
  });
});

// ── makeWhole: greatest(0, floor − (piece + hourly)) ───────────────────────────
describe("makeWhole — the min-wage top-up (THE CRIT invariant)", () => {
  it("FIRES when blended earnings fall below the floor (piece=2, hourly=0, floor=16 → 14)", () => {
    expect(makeWhole(2, 0, 16)).toBe(14);
  });

  it("lifts a worker EXACTLY to the floor (gross becomes the floor)", () => {
    const piece = 2;
    const hourly = 0;
    const floor = 16;
    expect(piece + hourly + makeWhole(piece, hourly, floor)).toBe(floor);
  });

  it("is ZERO when blended earnings are above the floor", () => {
    expect(makeWhole(20, 5, 16)).toBe(0);
  });

  it("is ZERO at the exact boundary (earnings == floor → no top-up)", () => {
    expect(makeWhole(16, 0, 16)).toBe(0);
    expect(makeWhole(10, 6, 16)).toBe(0);
  });

  it("is ZERO when the floor is 0 and earnings are non-negative (a reversal owes no minimum)", () => {
    // a reversing row carries floor 0 AND non-positive earnings; the relevant case is
    // floor 0 with zero earnings → no spurious top-up (matches the trigger exempting reversals).
    expect(makeWhole(0, 0, 0)).toBe(0);
    expect(makeWhole(5, 3, 0)).toBe(0);
  });

  it("rounds the top-up to cents", () => {
    // floor 16, piece 2.005, hourly 0 → 16 - 2.005 = 13.995 → 14.00 (round2)
    expect(makeWhole(2.005, 0, 16)).toBe(14);
  });
});

// ── gross: piece + hourly + makeWhole ──────────────────────────────────────────
describe("gross — blended earnings plus the make-whole", () => {
  it("equals the floor for a below-floor worker (the make-whole lifts it)", () => {
    expect(gross(2, 0, 16)).toBe(16);
  });

  it("is piece + hourly when above the floor (no top-up added)", () => {
    expect(gross(20, 5, 16)).toBe(25);
  });

  it("equals piece + hourly exactly at the boundary", () => {
    expect(gross(16, 0, 16)).toBe(16);
  });

  it("rounds the total to cents", () => {
    expect(gross(10.115, 5.005, 0)).toBe(15.12);
  });
});

// ── statutoryWithholding: each = round2(gross × pct/100) ───────────────────────
describe("statutoryWithholding — CSS / Seguro Educativo / décimo accrual", () => {
  const rates: StatutoryRates = {
    cssEmployeePct: 9.75,
    seguroEducativoPct: 1.25,
    decimoAccrualPct: 8.33,
  };

  it("applies each rate to gross at the placeholder Panama rates (gross 100)", () => {
    const w = statutoryWithholding(100, rates);
    expect(w.cssUsd).toBe(9.75);
    expect(w.seguroEducativoUsd).toBe(1.25);
    expect(w.decimoAccrualUsd).toBe(8.33);
  });

  it("rounds each withholding to cents", () => {
    // gross 16.40 × 9.75% = 1.599 → 1.60 ; × 1.25% = 0.205 → 0.21 (round2 of .205→.21)
    const w = statutoryWithholding(16.4, rates);
    expect(w.cssUsd).toBe(1.6);
    expect(w.seguroEducativoUsd).toBe(0.21);
    expect(w.decimoAccrualUsd).toBe(1.37); // 16.40 × 8.33% = 1.36612 → 1.37
  });

  it("is all zeros at zero rates", () => {
    const w = statutoryWithholding(100, {
      cssEmployeePct: 0,
      seguroEducativoPct: 0,
      decimoAccrualPct: 0,
    });
    expect(w).toEqual({ cssUsd: 0, seguroEducativoUsd: 0, decimoAccrualUsd: 0 });
  });

  it("is all zeros on a zero gross", () => {
    const w = statutoryWithholding(0, rates);
    expect(w).toEqual({ cssUsd: 0, seguroEducativoUsd: 0, decimoAccrualUsd: 0 });
  });
});

// ── netPay: gross − css − seguro (décimo is an accrual, NOT subtracted) ────────
describe("netPay — take-home = gross − CSS − Seguro Educativo (décimo EXCLUDED)", () => {
  it("subtracts CSS and Seguro Educativo from gross", () => {
    // gross 100, css 9.75, seguro 1.25 → 89.00
    expect(netPay(100, 9.75, 1.25)).toBe(89);
  });

  it("EXCLUDES the décimo accrual from the in-period net (matches net_usd generated column)", () => {
    // net depends ONLY on css + seguro; décimo (e.g. 8.33) never enters the formula.
    const withDecimoIgnored = netPay(100, 9.75, 1.25);
    expect(withDecimoIgnored).toBe(89);
    // sanity: if décimo were subtracted, net would be 80.67 — assert it is NOT.
    expect(withDecimoIgnored).not.toBe(80.67);
  });

  it("rounds the net to cents", () => {
    expect(netPay(16.4, 1.6, 0.21)).toBe(14.59);
  });
});

// ── computePayLine: composes the whole pay line end-to-end ─────────────────────
describe("computePayLine — the full pay line, composed end-to-end", () => {
  const rates: StatutoryRates = {
    cssEmployeePct: 9.75,
    seguroEducativoPct: 1.25,
    decimoAccrualPct: 8.33,
  };

  it("makes a BELOW-floor worker whole (gross == floor, madeWhole true)", () => {
    // 8h × 2.00 floor-rate = 16.00 floor; piece 2, hourly 0 → below floor.
    const line = computePayLine({
      pieceRateUsd: 2,
      hourlyUsd: 0,
      hoursWorked: 8,
      minWageHourlyUsd: 2,
      rates,
    });
    expect(line.floorUsd).toBe(16);
    expect(line.makeWholeUsd).toBe(14);
    expect(line.grossUsd).toBe(16); // gross == floor exactly
    expect(line.madeWhole).toBe(true);
    // withholdings on the gross (16.40-style): css 16×9.75%=1.56, seguro 16×1.25%=0.20
    expect(line.cssUsd).toBe(1.56);
    expect(line.seguroEducativoUsd).toBe(0.2);
    expect(line.decimoAccrualUsd).toBe(1.33); // 16 × 8.33% = 1.3328 → 1.33
    expect(line.netUsd).toBe(14.24); // 16 - 1.56 - 0.20
  });

  it("leaves an ABOVE-floor worker untouched (no top-up, madeWhole false)", () => {
    // 8h × 2.00 = 16 floor; piece 30, hourly 10 → well above floor.
    const line = computePayLine({
      pieceRateUsd: 30,
      hourlyUsd: 10,
      hoursWorked: 8,
      minWageHourlyUsd: 2,
      rates,
    });
    expect(line.floorUsd).toBe(16);
    expect(line.makeWholeUsd).toBe(0);
    expect(line.grossUsd).toBe(40); // piece + hourly, no top-up
    expect(line.madeWhole).toBe(false);
    expect(line.cssUsd).toBe(3.9); // 40 × 9.75%
    expect(line.seguroEducativoUsd).toBe(0.5); // 40 × 1.25%
    expect(line.decimoAccrualUsd).toBe(3.33); // 40 × 8.33% = 3.332 → 3.33
    expect(line.netUsd).toBe(35.6); // 40 - 3.90 - 0.50
  });

  it("treats a worker exactly at the floor as NOT made whole (boundary)", () => {
    const line = computePayLine({
      pieceRateUsd: 16,
      hourlyUsd: 0,
      hoursWorked: 8,
      minWageHourlyUsd: 2,
      rates,
    });
    expect(line.makeWholeUsd).toBe(0);
    expect(line.grossUsd).toBe(16);
    expect(line.madeWhole).toBe(false);
  });

  it("excludes the décimo accrual from net (it is tracked, not deducted in-period)", () => {
    const line = computePayLine({
      pieceRateUsd: 100,
      hourlyUsd: 0,
      hoursWorked: 0, // floor 0 → no make-whole
      minWageHourlyUsd: 2,
      rates,
    });
    // net = gross - css - seguro, NOT minus décimo
    expect(line.netUsd).toBe(
      round2(line.grossUsd - line.cssUsd - line.seguroEducativoUsd),
    );
    expect(line.decimoAccrualUsd).toBeGreaterThan(0);
  });
});
