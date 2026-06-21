/**
 * Cut-point projection for the P2-S3 fermentation tracker — a PURE function (no DB)
 * mirroring the `v_ferment_cutpoint` SQL view's logic on the client so the live curve
 * can draw the projected window-close marker without a round-trip.
 *
 * v1 model (per the spec's de-risk): a SIMPLE target-threshold crossing on pH. A
 * ferment's pH DROPS over time as sugars convert to acid; the recipe's `target_ph` is
 * the floor at which the window closes. `cutReached` fires once the live pH falls to or
 * through the target. While still above target, we extrapolate the recent pH slope to
 * PROJECT when the window will close — but only when the pH is genuinely falling (a
 * flat or rising curve gives no honest projection). The logged readings are the durable
 * asset; a better projection (curve fit / ML) is a Phase-4 upgrade behind this seam.
 */

/** One pH reading on the live curve: hours since the ferment started + the pH value. */
export interface FermentPhPoint {
  hoursElapsed: number;
  ph: number;
}

export interface CutPointProjection {
  /** True once the latest pH has reached/crossed the recipe target (≤ target). */
  cutReached: boolean;
  /** The chronologically latest pH reading, or null when there are no readings. */
  latestPh: number | null;
  /** Hours-elapsed at the latest reading, or null when there are none. */
  latestHours: number | null;
  /**
   * Projected hours-elapsed at which the pH reaches the target — null when there is no
   * recipe target, no readings, fewer than two points, or the pH is not falling. When
   * the cut is already reached, this is the latest reading's hours (the window is now).
   */
  projectedHours: number | null;
}

const EMPTY: CutPointProjection = {
  cutReached: false,
  latestPh: null,
  latestHours: null,
  projectedHours: null,
};

/**
 * Project the cut-point from a live pH series and a recipe target pH.
 *
 * @param points    the pH readings (any order; sorted internally by hoursElapsed).
 * @param targetPh  the recipe's target pH, or null when no recipe is bound.
 */
export function projectCutPoint(
  points: FermentPhPoint[],
  targetPh: number | null,
): CutPointProjection {
  if (points.length === 0) return EMPTY;

  // Sort chronologically so "latest" is unambiguous regardless of input order.
  const sorted = [...points].sort((a, b) => a.hoursElapsed - b.hoursElapsed);
  const latest = sorted[sorted.length - 1];

  const base: CutPointProjection = {
    cutReached: false,
    latestPh: latest.ph,
    latestHours: latest.hoursElapsed,
    projectedHours: null,
  };

  // No recipe target => surface the latest reading for the curve, but never project.
  if (targetPh === null || !Number.isFinite(targetPh)) return base;

  // Already at/through the target — the window is closing now.
  if (latest.ph <= targetPh) {
    return { ...base, cutReached: true, projectedHours: latest.hoursElapsed };
  }

  // Still above target: extrapolate the recent slope to project the crossing. Use the
  // last two readings; only project when the pH is genuinely FALLING (slope < 0).
  if (sorted.length < 2) return base;
  const prev = sorted[sorted.length - 2];
  const dPh = latest.ph - prev.ph;
  const dH = latest.hoursElapsed - prev.hoursElapsed;
  if (dH <= 0 || dPh >= 0) return base; // flat / rising / zero-time → no honest projection

  const slope = dPh / dH; // pH per hour, negative
  const hoursToTarget = (targetPh - latest.ph) / slope; // both negative → positive
  return { ...base, projectedHours: latest.hoursElapsed + hoursToTarget };
}
