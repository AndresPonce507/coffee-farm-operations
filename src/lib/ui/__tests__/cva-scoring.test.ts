import { describe, expect, it } from "vitest";

import {
  CVA_ATTRIBUTES,
  LEGACY_ATTRIBUTES,
  attributesFor,
  cupFinalScore,
  cupQualityBand,
  type CupAttributeScore,
} from "@/lib/ui/cva-scoring";

/**
 * Pure-domain test for the cupping-score math (P2-S6). The SCA CVA (2023) and the
 * legacy 100-point totals are the durable asset — the spec mandates they be
 * provably correct (red→green) BEFORE any UI. No DB here: these are pure functions
 * over an array of attribute scores. This mirrors the authoritative additive total
 * the `v_cup_final_score` SQL view computes, so the UI preview and the server agree.
 */

function scores(pairs: [string, number][]): CupAttributeScore[] {
  return pairs.map(([attribute, score]) => ({ attribute, score }));
}

describe("attributesFor — the per-protocol attribute set", () => {
  it("lists the 8 SCA CVA affective attributes", () => {
    expect(attributesFor("sca-cva")).toEqual(CVA_ATTRIBUTES);
    expect(CVA_ATTRIBUTES).toHaveLength(8);
  });

  it("lists the 10 legacy 100-pt scoresheet attributes", () => {
    expect(attributesFor("legacy-100")).toEqual(LEGACY_ATTRIBUTES);
    expect(LEGACY_ATTRIBUTES).toHaveLength(10);
  });
});

describe("cupFinalScore — SCA CVA (2023) additive total", () => {
  it("sums the eight CVA attribute scores", () => {
    const s = scores([
      ["fragrance", 8],
      ["flavor", 8],
      ["aftertaste", 7],
      ["acidity", 8],
      ["sweetness", 7],
      ["mouthfeel", 8],
      ["overall", 8],
      ["uniformity", 8],
    ]);
    expect(cupFinalScore("sca-cva", s)).toBeCloseTo(62, 6);
  });

  it("a perfect CVA card (all 10s across 8 attributes) totals 80", () => {
    const s = CVA_ATTRIBUTES.map((a) => ({ attribute: a, score: 10 }));
    expect(cupFinalScore("sca-cva", s)).toBeCloseTo(80, 6);
  });

  it("an empty card scores 0 (no fabricated baseline)", () => {
    expect(cupFinalScore("sca-cva", [])).toBe(0);
  });
});

describe("cupFinalScore — legacy 100-pt total", () => {
  it("sums the ten legacy attribute scores", () => {
    const s = scores([
      ["fragrance", 8.5],
      ["flavor", 8.75],
      ["aftertaste", 8.25],
      ["acidity", 8.5],
      ["body", 8.5],
      ["balance", 8.5],
      ["uniformity", 10],
      ["clean-cup", 10],
      ["sweetness", 10],
      ["overall", 5],
    ]);
    // 8.5+8.75+8.25+8.5+8.5+8.5+10+10+10+5 = 86
    expect(cupFinalScore("legacy-100", s)).toBeCloseTo(86, 6);
  });

  it("a flawless legacy card (all 10s across 10 attributes) totals 100", () => {
    const s = LEGACY_ATTRIBUTES.map((a) => ({ attribute: a, score: 10 }));
    expect(cupFinalScore("legacy-100", s)).toBeCloseTo(100, 6);
  });
});

describe("cupFinalScore — only counts scores, ignores unknown attributes defensively", () => {
  it("totals whatever attribute rows are supplied (matches the SQL additive view)", () => {
    // the DB view sums whatever was logged; the pure fn must agree for parity.
    expect(cupFinalScore("sca-cva", scores([["flavor", 9], ["acidity", 8]]))).toBeCloseTo(17, 6);
  });
});

describe("cupQualityBand — maps a final score to a human band", () => {
  // The specialty thresholds the family reads alongside the generated sca_grade.
  it("90+ is Presidential", () => {
    expect(cupQualityBand(91)).toBe("Presidential");
    expect(cupQualityBand(90)).toBe("Presidential");
  });
  it("85–89.99 is Specialty", () => {
    expect(cupQualityBand(89.5)).toBe("Specialty");
    expect(cupQualityBand(85)).toBe("Specialty");
  });
  it("80–84.99 is Premium", () => {
    expect(cupQualityBand(84)).toBe("Premium");
    expect(cupQualityBand(80)).toBe("Premium");
  });
  it("below 80 is Below Specialty", () => {
    expect(cupQualityBand(79.99)).toBe("Below Specialty");
    expect(cupQualityBand(0)).toBe("Below Specialty");
  });
});
