import type { BadgeTone } from "@/components/ui/badge";

/**
 * grade.ts — the CLIENT-SAFE, pure mirror of the `mill_grade.sca_prep` GENERATED
 * column (20260705093000_dry_milling_finalize.sql).
 *
 * The DATABASE is the single source of truth: `sca_prep` is a stored GENERATED column,
 * so the recorded grade can NEVER drift from its defect counts. This helper only
 * PREVIEWS the band the operator is about to mint — a UI courtesy so the grade is never
 * a surprise. Keep the cutoffs byte-identical to the SQL `case` expression:
 *   EP-Specialty : cat1 = 0  AND (cat1 + cat2) <= 5
 *   Premium      : cat1 <= 3 AND (cat1 + cat2) <= 8
 *   Exchange     :              (cat1 + cat2) <= 23
 *   else           Below Standard
 */
export type ScaPrep = "EP-Specialty" | "Premium" | "Exchange" | "Below Standard";

export function scaPrep(cat1Defects: number, cat2Defects: number): ScaPrep {
  const total = cat1Defects + cat2Defects;
  if (cat1Defects === 0 && total <= 5) return "EP-Specialty";
  if (cat1Defects <= 3 && total <= 8) return "Premium";
  if (total <= 23) return "Exchange";
  return "Below Standard";
}

/** Band → WCAG-AA glass badge tone (forest = the premium EP band, cherry = below std). */
export function scaPrepTone(prep: ScaPrep): BadgeTone {
  switch (prep) {
    case "EP-Specialty":
      return "forest";
    case "Premium":
      return "sky";
    case "Exchange":
      return "honey";
    default:
      return "cherry";
  }
}

/**
 * Outturn as a fraction (green / parchment) — mirrors `milling_runs.outturn_pct`.
 * Returns null on a non-positive parchment mass (never a divide-by-zero / fabricated 0).
 */
export function outturnFraction(
  greenKgOut: number,
  parchmentKgIn: number,
): number | null {
  if (!(parchmentKgIn > 0)) return null;
  return greenKgOut / parchmentKgIn;
}
