/**
 * P2-S12 · IPM economic-threshold engine — the pure, DB-free recommend/hold model.
 *
 * Integrated Pest Management acts on EVIDENCE, not fear: a control intervention is
 * only economically (and ecologically) justified once a pest's incidence reaches
 * the published action threshold for that pest. Below it, spraying wastes money
 * and burns the PHI/REI/cert budget for no yield gain. This module compares a
 * scouting observation to the threshold and returns a recommend/hold call with an
 * exceedance magnitude (which drives the fired task's priority).
 *
 * It is the SSOT the SQL `v_ipm_threshold` view mirrors, kept pure so the UI badge
 * and the DB recommendation are identical and exhaustively testable at $0.
 */

import type { Priority } from "@/lib/types";

/**
 * Broca (coffee borer, *Hypothenemus hampei*) economic action threshold — the
 * widely-taught ~5% infested-cherry level at which control pays for itself.
 * CALIBRATION FLAG: a transparent v1 constant, family/agronomist tunable.
 */
export const BROCA_ACTION_THRESHOLD_PCT = 5;

/**
 * Roya (coffee leaf rust, *Hemileia vastatrix*) economic action threshold — a
 * ~10% leaf-incidence level at which preventive control is warranted.
 * CALIBRATION FLAG: a transparent v1 constant, family/agronomist tunable.
 */
export const ROYA_ACTION_THRESHOLD_PCT = 10;

/** The published thresholds, keyed by pest kind. Add pests here, never inline. */
const THRESHOLDS: Readonly<Record<string, number>> = {
  broca: BROCA_ACTION_THRESHOLD_PCT,
  roya: ROYA_ACTION_THRESHOLD_PCT,
};

/** The published action threshold for a pest, or null when the pest is unknown. */
export function thresholdFor(pestKind: string): number | null {
  const t = THRESHOLDS[pestKind];
  return t === undefined ? null : t;
}

/** The outcome of evaluating a scouting observation against the threshold. */
export interface ThresholdEvaluation {
  /** Recommend a control intervention? (incidence at-or-above the threshold). */
  recommend: boolean;
  /** The threshold applied, or null when the pest has no known threshold. */
  threshold: number | null;
  /** incidence − threshold; negative below, 0 at, positive above. NaN if unknown. */
  exceedance: number;
  /** The priority a fired control task should carry, scaled by exceedance. */
  priority: Priority;
}

/** Map an exceedance (percentage points over threshold) to a task priority. */
function priorityFor(exceedance: number): Priority {
  if (exceedance >= 10) return "high";
  if (exceedance >= 0) return "medium";
  return "low";
}

/**
 * Evaluate a scouting observation: does this pest incidence justify control?
 * `>=` is the action boundary — at the threshold you act. An unknown pest can
 * never trigger a recommendation (no threshold to act on), surfaced honestly.
 */
export function evaluateThreshold(
  pestKind: string,
  incidencePct: number,
): ThresholdEvaluation {
  const threshold = thresholdFor(pestKind);
  if (threshold === null) {
    return { recommend: false, threshold: null, exceedance: Number.NaN, priority: "low" };
  }
  const exceedance = incidencePct - threshold;
  return {
    recommend: incidencePct >= threshold,
    threshold,
    exceedance,
    priority: priorityFor(exceedance),
  };
}
