import { describe, expect, it } from "vitest";

import { outturnFraction, scaPrep, scaPrepTone } from "../grade";

/**
 * grade.ts is the CLIENT-SAFE mirror of the mill_grade.sca_prep GENERATED column
 * (20260705093000_dry_milling_finalize.sql). The database is the source of truth;
 * this pure helper only previews the band the operator is about to mint, so the cutoffs
 * MUST stay byte-identical to the SQL:
 *   EP-Specialty : cat1 = 0 AND (cat1 + cat2) <= 5
 *   Premium      : cat1 <= 3 AND (cat1 + cat2) <= 8
 *   Exchange     : (cat1 + cat2) <= 23
 *   else           Below Standard
 */
describe("scaPrep — mirrors the SCA full-defect bands exactly", () => {
  it("0 primary, <=5 total → EP-Specialty (the premium band)", () => {
    expect(scaPrep(0, 0)).toBe("EP-Specialty");
    expect(scaPrep(0, 5)).toBe("EP-Specialty");
  });

  it("crosses to Premium the instant a primary defect appears or total exceeds 5", () => {
    // a single primary defect leaves EP even with a clean total.
    expect(scaPrep(1, 0)).toBe("Premium");
    // 0 primary but 6 total tips out of EP into Premium.
    expect(scaPrep(0, 6)).toBe("Premium");
    // Premium ceiling: 3 primary AND 8 total inclusive.
    expect(scaPrep(3, 5)).toBe("Premium");
  });

  it("falls to Exchange when primary > 3 OR total in (8, 23]", () => {
    // 4 primary breaks the Premium primary cap even at a low total.
    expect(scaPrep(4, 0)).toBe("Exchange");
    // total 9 breaks the Premium total cap.
    expect(scaPrep(3, 6)).toBe("Exchange");
    // Exchange ceiling is 23 total inclusive.
    expect(scaPrep(0, 23)).toBe("Exchange");
  });

  it("is Below Standard past 23 total defects", () => {
    expect(scaPrep(0, 24)).toBe("Below Standard");
    expect(scaPrep(20, 10)).toBe("Below Standard");
  });
});

describe("scaPrepTone — band → glass badge tone", () => {
  it("maps each band to its WCAG-AA token tone", () => {
    expect(scaPrepTone("EP-Specialty")).toBe("forest");
    expect(scaPrepTone("Premium")).toBe("sky");
    expect(scaPrepTone("Exchange")).toBe("honey");
    expect(scaPrepTone("Below Standard")).toBe("cherry");
  });
});

describe("outturnFraction — mirrors milling_runs.outturn_pct", () => {
  it("is green / parchment as a fraction", () => {
    expect(outturnFraction(82, 100)).toBeCloseTo(0.82, 9);
    expect(outturnFraction(1640, 2000)).toBeCloseTo(0.82, 9);
  });

  it("returns null on a non-positive parchment mass (never a divide-by-zero)", () => {
    expect(outturnFraction(82, 0)).toBeNull();
    expect(outturnFraction(82, -1)).toBeNull();
  });
});
