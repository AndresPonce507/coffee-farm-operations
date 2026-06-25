/**
 * P3-S0 · Dual-regime resolver — the PURE, DB-free mirror of the pricing regime
 * rule. The DATABASE is the source of truth: `price_regime_for_lot(text)` and the
 * `_enforce_regime_pricing` BEFORE-INSERT trigger (migration
 * 20260703090000_dual_regime_pricing.sql) are the authoritative guard — a
 * Presidential/Specialty single-origin lot physically cannot be quoted on the
 * commodity index. This module mirrors that exact rule for client-side display +
 * pre-flight validation only, so the /pricing UI and the DB can never disagree.
 *
 * The reserve band itself derives from the cupping score via the GENERATED
 * `green_lots.sca_grade` column (migration 20260621093500_green_inventory.sql):
 * the bands below are IDENTICAL to that column. Pure functions only — no Supabase,
 * no React — so the rule is exhaustively unit-testable at $0.
 */

/** The two pricing regimes (mirrors the DB `pricing_regime` enum). */
export type PricingRegime = "commodity" | "reserve";

/** The SCA grade bands (mirrors the generated `green_lots.sca_grade` values). */
export type ScaGrade = "Presidential" | "Specialty" | "Premium" | "Below Specialty";

/**
 * The SCA bands that MANDATE the reserve regime (when the lot is single-origin).
 * Mirrors the DB predicate `sca_grade in ('Presidential','Specialty')` inside
 * `price_regime_for_lot`.
 */
export const RESERVE_GRADES: readonly ScaGrade[] = ["Presidential", "Specialty"];

/** Score floor for the Presidential band — identical to the generated column. */
export const SCA_PRESIDENTIAL_MIN = 90;
/** Score floor for the Specialty band — identical to the generated column. */
export const SCA_SPECIALTY_MIN = 85;
/** Score floor for the Premium band — identical to the generated column. */
export const SCA_PREMIUM_MIN = 80;

/**
 * Band a cupping score into its SCA grade — IDENTICAL to the GENERATED
 * `green_lots.sca_grade` column (the DB single source of truth; this only mirrors
 * it). `>= 90 Presidential ; >= 85 Specialty ; >= 80 Premium ; else Below Specialty`.
 */
export function scaGradeForScore(score: number): ScaGrade {
  if (score >= SCA_PRESIDENTIAL_MIN) return "Presidential";
  if (score >= SCA_SPECIALTY_MIN) return "Specialty";
  if (score >= SCA_PREMIUM_MIN) return "Premium";
  return "Below Specialty";
}

/**
 * Resolve a lot's pricing regime — the pure mirror of `price_regime_for_lot`:
 * `'reserve'` WHEN the SCA grade is in the reserve band (Presidential/Specialty)
 * AND the lot is single-origin; otherwise `'commodity'`.
 *
 * - `grade` is the DB SSOT (the generated `sca_grade`); when supplied it WINS.
 *   When it's null/undefined the grade is derived from `score` using the same
 *   bands as the generated column, so a caller that only has the score is correct
 *   too (boundary-correct: 84.9 -> Premium -> commodity ; 85.0 -> Specialty ->
 *   reserve-eligible).
 * - `singleOrigin` mirrors `coalesce(is_single_origin, false)`: a null/undefined
 *   single-origin is treated as `false` (so a blend — e.g. a part-Geisha blend —
 *   stays commodity no matter how high the grade).
 */
export function regimeForLot(
  grade: ScaGrade | string | null | undefined,
  score: number | null | undefined,
  singleOrigin: boolean | null | undefined,
): PricingRegime {
  const resolvedGrade: string =
    grade ?? (score != null ? scaGradeForScore(score) : "Below Specialty");
  const isReserveBand = (RESERVE_GRADES as readonly string[]).includes(resolvedGrade);
  // coalesce(is_single_origin, false): only an explicit true is single-origin.
  if (isReserveBand && singleOrigin === true) return "reserve";
  return "commodity";
}
