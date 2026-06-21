import type { CuppingProtocol, ScaGrade } from "@/lib/types";

/**
 * Pure cupping-score math (P2-S6) — the durable, exhaustively-tested asset the
 * spec mandates be provably correct BEFORE any UI. Both the SCA CVA (2023)
 * affective scale and the legacy 100-point scoresheet are ADDITIVE over their
 * attribute scores, so the final is the sum — exactly what the `v_cup_final_score`
 * SQL view computes, so the in-form preview and the server agree (parity).
 *
 * No DB, no React — just data in, number out. The per-protocol attribute SETS live
 * here so the cupping form renders the right scoresheet for the chosen protocol.
 */

/** One attribute's score on a scoresheet (CVA attributes 0–10; legacy 0–10). */
export interface CupAttributeScore {
  attribute: string;
  score: number;
}

/** The eight SCA CVA (2023) affective attributes (each 0–10 → max 80). */
export const CVA_ATTRIBUTES = [
  "fragrance",
  "flavor",
  "aftertaste",
  "acidity",
  "sweetness",
  "mouthfeel",
  "overall",
  "uniformity",
] as const;

/** The ten legacy 100-point scoresheet attributes (each 0–10 → max 100). */
export const LEGACY_ATTRIBUTES = [
  "fragrance",
  "flavor",
  "aftertaste",
  "acidity",
  "body",
  "balance",
  "uniformity",
  "clean-cup",
  "sweetness",
  "overall",
] as const;

/** The ordered attribute set for a protocol (drives the scoresheet UI). */
export function attributesFor(protocol: CuppingProtocol): readonly string[] {
  return protocol === "sca-cva" ? CVA_ATTRIBUTES : LEGACY_ATTRIBUTES;
}

/**
 * The protocol-correct final score = the sum of the supplied attribute scores.
 * Mirrors the additive `v_cup_final_score` SQL view exactly (it sums whatever
 * attribute rows were logged), so the client preview never disagrees with the
 * server total. An empty card scores 0 — never a fabricated baseline.
 */
export function cupFinalScore(
  _protocol: CuppingProtocol,
  scores: readonly CupAttributeScore[],
): number {
  return scores.reduce((sum, s) => sum + (Number.isFinite(s.score) ? s.score : 0), 0);
}

/**
 * Map a final cup score to the same specialty bands the Phase-1 generated
 * `green_lots.sca_grade` column emits, so the cupping surface speaks the family's
 * existing grade vocabulary. Presidential ≥ 90, Specialty ≥ 85, Premium ≥ 80.
 */
export function cupQualityBand(finalScore: number): ScaGrade {
  if (finalScore >= 90) return "Presidential";
  if (finalScore >= 85) return "Specialty";
  if (finalScore >= 80) return "Premium";
  return "Below Specialty";
}
