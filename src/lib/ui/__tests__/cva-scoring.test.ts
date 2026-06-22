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

describe("cupFinalScore — SCA CVA (2023) affective transform", () => {
  // The real SCA CVA 2023 cup-form final score is an AFFINE transform of the eight
  // 1–9 hedonic section scores: Score = 0.65625 · Σ + 52.75, minus 2 per non-uniform
  // and 4 per defective cup — a 58–100 scale where a flawless cup = 100. These are the
  // published CVA worked examples the spec mandated be green BEFORE any UI.
  function cva(score: number) {
    return CVA_ATTRIBUTES.map((a) => ({ attribute: a, score }));
  }

  it("all-7s totals 89.5 (the spec's dogfood worked example)", () => {
    // 0.65625 · (8·7) + 52.75 = 36.75 + 52.75 = 89.5
    expect(cupFinalScore("sca-cva", cva(7))).toBeCloseTo(89.5, 6);
  });

  it("a flawless CVA cup (all 9s on the 1–9 hedonic scale) totals 100", () => {
    // 0.65625 · 72 + 52.75 = 47.25 + 52.75 = 100
    expect(cupFinalScore("sca-cva", cva(9))).toBeCloseTo(100, 6);
  });

  it("all-6s totals 84.25", () => {
    // 0.65625 · 48 + 52.75 = 31.5 + 52.75 = 84.25
    expect(cupFinalScore("sca-cva", cva(6))).toBeCloseTo(84.25, 6);
  });

  it("the floor of the scale (all 1s) totals 58", () => {
    // 0.65625 · 8 + 52.75 = 5.25 + 52.75 = 58
    expect(cupFinalScore("sca-cva", cva(1))).toBeCloseTo(58, 6);
  });

  it("subtracts 2 for a non-uniform cup", () => {
    // all-7s (89.5) − 2 = 87.5
    expect(
      cupFinalScore("sca-cva", cva(7), { nonUniform: true }),
    ).toBeCloseTo(87.5, 6);
  });

  it("subtracts 4 for a defective cup", () => {
    // all-7s (89.5) − 4 = 85.5
    expect(
      cupFinalScore("sca-cva", cva(7), { defective: true }),
    ).toBeCloseTo(85.5, 6);
  });

  it("subtracts both deductions together (−2 −4 = −6)", () => {
    // all-7s (89.5) − 6 = 83.5
    expect(
      cupFinalScore("sca-cva", cva(7), { nonUniform: true, defective: true }),
    ).toBeCloseTo(83.5, 6);
  });

  it("clamps to the 58–100 range and never exceeds 100", () => {
    // all-9s already maxes; a (defensive) over-range section can't push past 100.
    expect(cupFinalScore("sca-cva", cva(9))).toBeLessThanOrEqual(100);
    // deductions can't drop below the 58 floor on a near-floor card.
    expect(
      cupFinalScore("sca-cva", cva(1), { nonUniform: true, defective: true }),
    ).toBeCloseTo(58, 6);
  });

  it("an empty card scores 0 — no fabricated 58-point baseline", () => {
    // A fresh, unscored card is not a 'Below Specialty' cup; it is unscored.
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

describe("cupFinalScore — transforms whatever section rows are supplied", () => {
  it("applies the CVA affine transform over the supplied section scores", () => {
    // A partial card transforms the running Σ (here 9+8=17): 0.65625·17 + 52.75 = 63.91.
    // (The server v_cup_final_score view must apply the SAME transform for parity —
    // flagged to the migration owner; it still sums raw, so it currently disagrees.)
    expect(
      cupFinalScore("sca-cva", scores([["flavor", 9], ["acidity", 8]])),
    ).toBeCloseTo(63.91, 6);
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
