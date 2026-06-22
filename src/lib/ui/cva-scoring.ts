import type { CuppingProtocol, ScaGrade } from "@/lib/types";

/**
 * Pure cupping-score math (P2-S6) — the durable, exhaustively-tested asset the
 * spec mandates be provably correct BEFORE any UI.
 *
 * The two protocols do NOT share scoring math:
 *  • SCA CVA (2023) is an AFFINE (affective) transform of the eight 1–9 hedonic
 *    section scores: Score = 0.65625 · Σ + 52.75, minus 2 per non-uniform cup and
 *    4 per defective cup, on a 58–100 scale where a flawless cup = 100. A naive sum
 *    (max 80) silently under-grades a world-class lot by ~20 points and can never
 *    reach Specialty/Presidential — the exact subtle error the spec singled out as
 *    the slice's highest risk. Worked examples (all-7s ⇒ 89.5, all-9s ⇒ 100) are
 *    pinned in the tests.
 *  • Legacy 100-point is ADDITIVE over its ten sub-scores (each up to 10 → max 100).
 *
 * No DB, no React — just data in, number out. The per-protocol attribute SETS live
 * here so the cupping form renders the right scoresheet for the chosen protocol.
 *
 * NOTE on server parity: the `v_cup_final_score` SQL view must apply the SAME
 * per-protocol transform so the in-form preview and the server agree. The view is
 * owned by the QC-cupping migration (schema lane) and still computes a raw additive
 * sum — flagged for the migration owner; until it is updated the sca-cva server
 * total will disagree with this corrected client total.
 */

/** One attribute's score on a scoresheet. Legacy sub-scores are up to 10; CVA
 *  section scores are on the 1–9 hedonic scale the affine transform expects. */
export interface CupAttributeScore {
  attribute: string;
  score: number;
}

/** Per-cup deductions for the SCA CVA (2023) final-score transform: −2 for a
 *  non-uniform cup, −4 for a defective cup (both default off). */
export interface CvaDeductions {
  nonUniform?: boolean;
  defective?: boolean;
}

/** The eight SCA CVA (2023) affective attributes (each scored 1–9 hedonic). */
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

/** The SCA CVA (2023) affective transform: Score = 0.65625 · Σ + 52.75, clamped
 *  to the protocol's 58–100 scale, with worked examples all-7s ⇒ 89.5, all-9s ⇒ 100. */
const CVA_SLOPE = 0.65625;
const CVA_INTERCEPT = 52.75;
const CVA_FLOOR = 58;
const CVA_CEIL = 100;
const CVA_NON_UNIFORM_DEDUCTION = 2;
const CVA_DEFECTIVE_DEDUCTION = 4;

/**
 * The protocol-correct final cup score.
 *
 *  • `sca-cva` — the real SCA CVA 2023 affective transform of the eight 1–9
 *    section scores: 0.65625 · Σ + 52.75, minus 2 (non-uniform) / 4 (defective),
 *    clamped to [58, 100]. NOT a naive sum (that maxes at 80 and can never reach
 *    Specialty). An empty card scores 0 — never the fabricated 58-point floor.
 *  • `legacy-100` — the additive sum of the ten sub-scores (flawless ⇒ 100).
 *
 * Rounded to 2 dp to kill float dust and match the rounded server view.
 */
export function cupFinalScore(
  protocol: CuppingProtocol,
  scores: readonly CupAttributeScore[],
  deductions: CvaDeductions = {},
): number {
  const sum = scores.reduce(
    (acc, s) => acc + (Number.isFinite(s.score) ? s.score : 0),
    0,
  );

  if (protocol !== "sca-cva") {
    // Legacy 100-pt scoresheet: the final is the additive total of the sub-scores.
    return round2(sum);
  }

  // A fresh, unscored CVA card is unscored — not a 58-point 'Below Specialty' cup.
  if (scores.length === 0) return 0;

  const penalty =
    (deductions.nonUniform ? CVA_NON_UNIFORM_DEDUCTION : 0) +
    (deductions.defective ? CVA_DEFECTIVE_DEDUCTION : 0);
  const raw = CVA_SLOPE * sum + CVA_INTERCEPT - penalty;
  return round2(Math.min(CVA_CEIL, Math.max(CVA_FLOOR, raw)));
}

/** Round to 2 decimal places (kills binary-float dust like 89.50000000001). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
