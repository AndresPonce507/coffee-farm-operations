import { describe, expect, it } from "vitest";

import {
  RESERVE_GRADES,
  regimeForLot,
  scaGradeForScore,
  type ScaGrade,
} from "@/lib/pricing/regime";

// ─────────────────────────────────────────────────────────────────────────────
// scaGradeForScore — MUST mirror the GENERATED `green_lots.sca_grade` column
// (migration 20260621093500_green_inventory.sql):
//   >= 90 -> 'Presidential' ; >= 85 -> 'Specialty' ; >= 80 -> 'Premium' ;
//   else 'Below Specialty'. The DB is the source of truth; this only mirrors it
//   for client-side display/validation.
// ─────────────────────────────────────────────────────────────────────────────
describe("scaGradeForScore — SCA bands, identical to the generated DB column", () => {
  it("bands 90+ as Presidential", () => {
    expect(scaGradeForScore(90)).toBe("Presidential");
    expect(scaGradeForScore(94)).toBe("Presidential");
  });

  it("bands [85,90) as Specialty", () => {
    expect(scaGradeForScore(85)).toBe("Specialty");
    expect(scaGradeForScore(89.9)).toBe("Specialty");
  });

  it("bands [80,85) as Premium", () => {
    expect(scaGradeForScore(80)).toBe("Premium");
    expect(scaGradeForScore(84.9)).toBe("Premium");
  });

  it("bands below 80 as Below Specialty", () => {
    expect(scaGradeForScore(79.9)).toBe("Below Specialty");
    expect(scaGradeForScore(0)).toBe("Below Specialty");
  });

  it("is boundary-correct at exactly 85 (the reserve/commodity grade hinge)", () => {
    // 84.9 -> Premium (commodity) ; 85.0 -> Specialty (reserve-eligible)
    expect(scaGradeForScore(84.9)).toBe("Premium");
    expect(scaGradeForScore(85)).toBe("Specialty");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESERVE_GRADES — the reserve-mandatory band, mirroring the DB predicate
//   `sca_grade in ('Presidential','Specialty')` in price_regime_for_lot.
// ─────────────────────────────────────────────────────────────────────────────
describe("RESERVE_GRADES — the reserve-mandatory SCA bands", () => {
  it("is exactly Presidential + Specialty (mirrors the DB IN-list)", () => {
    expect([...RESERVE_GRADES]).toEqual(["Presidential", "Specialty"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// regimeForLot — mirrors price_regime_for_lot / _enforce_regime_pricing:
//   'reserve' WHEN sca_grade in (Presidential,Specialty) AND single-origin,
//   else 'commodity'. A NULL single-origin coalesces to false (NOT reserve).
// ─────────────────────────────────────────────────────────────────────────────
describe("regimeForLot — dual-regime resolver (mirrors the DB keystone rule)", () => {
  it("is reserve for a Presidential single-origin lot (the BoP Geisha)", () => {
    expect(regimeForLot("Presidential", 94, true)).toBe("reserve");
  });

  it("is reserve for a Specialty single-origin lot", () => {
    expect(regimeForLot("Specialty", 86, true)).toBe("reserve");
  });

  it("is commodity for a Premium single-origin lot (below the reserve band)", () => {
    expect(regimeForLot("Premium", 82, true)).toBe("commodity");
  });

  it("is commodity for a high-grade NON-single-origin blend (the part-Geisha blend)", () => {
    // A blend is never reserve no matter how high the grade — it isn't single-origin.
    expect(regimeForLot("Presidential", 94, false)).toBe("commodity");
  });

  it("treats a NULL single-origin as false (coalesce(is_single_origin,false)) -> commodity", () => {
    expect(regimeForLot("Presidential", 94, null)).toBe("commodity");
    expect(regimeForLot("Specialty", 88, undefined)).toBe("commodity");
  });

  it("derives the grade from the score when no grade is supplied", () => {
    // boundary: 84.9 -> Premium -> commodity ; 85.0 -> Specialty -> reserve
    expect(regimeForLot(null, 84.9, true)).toBe("commodity");
    expect(regimeForLot(null, 85, true)).toBe("reserve");
    expect(regimeForLot(null, 90, true)).toBe("reserve");
  });

  it("is commodity for a below-specialty single-origin lot", () => {
    expect(regimeForLot(null, 79.9, true)).toBe("commodity");
  });

  it("prefers the explicit grade (the DB SSOT) over the score when both are given", () => {
    // sca_grade is the generated SSOT in the DB; an explicit grade wins.
    const grade: ScaGrade = "Specialty";
    expect(regimeForLot(grade, 50, true)).toBe("reserve");
  });
});
