/**
 * P2-S8 · Harvest-planning agronomy — the pure, DB-free maturation model.
 *
 * Readiness is *derived*, never a typed status. A plot is "ready" because its
 * accumulated growing-degree-days (GDD) have met the bloom→cherry requirement —
 * not because anyone hand-set a flag. The whole module is pure functions so the
 * `v_harvest_readiness` SQL view, the `/plan` UI, and S5 dispatch can all reason
 * about the same numbers, and so the model is exhaustively unit-testable at $0.
 *
 * v1 is a transparent GDD-threshold model (DESIGN P2-S8 de-risk): the family's own
 * historical bloom/harvest dates calibrate the constants below, and every reading
 * carries an honest confidence rather than a false certainty. NDVI is an OPTIONAL
 * upward/downward nudge (NDVI-ready, degrades cleanly to weather-only GDD when the
 * satellite signal is absent — Volcán is cloud-bound half the year).
 */

/** GDD base temperature for Arabica coffee (°C). Growth below this contributes 0. */
export const GDD_BASE_C = 10;

/** GDD upper cap (°C). Days hotter than this don't accelerate ripening further. */
export const GDD_CAP_C = 30;

/**
 * Approximate accumulated GDD from bloom to picking-ripe cherry for the estate's
 * flagship Geisha at the lower gradient. CALIBRATION FLAG: a transparent v1
 * constant the family's logged bloom→harvest dates will refine (DESIGN P2-S8).
 */
export const GEISHA_BLOOM_TO_CHERRY_GDD = 2200;

/** Bottom of the Janson altitude gradient (masl) — the first plots to ripen. */
export const GRADIENT_FLOOR_MASL = 1360;

/**
 * Days of extra ripening per 100 m of altitude above the gradient floor. The
 * cool, high Geisha plots ripen LATER, so the harvest staggers DOWN the mountain.
 * CALIBRATION FLAG: a transparent v1 constant (~4 days / 100 m), family-tunable.
 */
export const STAGGER_DAYS_PER_100M = 4;

const MS_PER_DAY = 86_400_000;

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/**
 * Single-day growing-degree-days: the day's mean temperature above the 10°C base,
 * with the hi capped at 30°C so a heat spike can't fabricate ripening. Never
 * negative — a cold day contributes 0, it does not subtract accumulated heat.
 */
export function dailyGdd(hiC: number, loC: number): number {
  const cappedHi = Math.min(hiC, GDD_CAP_C);
  const cappedLo = Math.min(loC, GDD_CAP_C);
  const mean = (cappedHi + cappedLo) / 2;
  return Math.max(0, mean - GDD_BASE_C);
}

/** Accumulate a daily hi/lo series into total GDD. Empty series → 0 (no guess). */
export function accumulateGdd(series: ReadonlyArray<{ hi: number; lo: number }>): number {
  return series.reduce((sum, d) => sum + dailyGdd(d.hi, d.lo), 0);
}

/**
 * The altitude stagger, in days: how much LATER a plot ripens than the gradient
 * floor purely because it sits higher. Clamped to 0 below the floor (never
 * negative). This is what spreads the harvest across the 1,360–1,700 masl band.
 */
export function staggerOffsetDays(altitudeMasl: number): number {
  const above = Math.max(0, altitudeMasl - GRADIENT_FLOOR_MASL);
  return (above / 100) * STAGGER_DAYS_PER_100M;
}

/**
 * Project the predicted ready date (ISO yyyy-mm-dd) from the bloom date, the GDD
 * accrual rate, the altitude stagger, and how far the plot already is toward its
 * bloom→cherry requirement. Returns `null` for a missing bloom date or a
 * non-positive accrual rate — an honest unknown, never a fabricated date.
 *
 * SAME-NUMBERS CONTRACT: this MUST compute the identical quantity as the
 * `v_harvest_readiness` SQL view (migration 20260622100000), which the /plan UI
 * and S5 dispatch actually read:
 *
 *     bloom_date
 *       + (greatest(0, gdd_to_cherry - gdd_accumulated) / 50.0)::int   -- REMAINING gdd, not full
 *       + ceil(stagger_days)::int                                      -- whole-day stagger ceiling
 *
 * So the numerator is the GDD *still required* (full requirement minus what's
 * already accumulated, floored at 0) over `gddPerDay` (the SQL's nominal 50), and
 * the stagger is added as a whole-day ceiling — Postgres `(numeric)::int` rounds
 * to the nearest day, so the GDD-days term uses `Math.round` to match. A drift
 * test in the PGlite harness pins the two formulas to the same fixture; if you
 * change one, change both (the module header's reason-for-existing).
 */
export function predictReadyDate(
  bloomDate: string | null,
  gddPerDay: number,
  altitudeMasl: number,
  gddToCherry: number = GEISHA_BLOOM_TO_CHERRY_GDD,
  gddAccumulated: number = 0,
): string | null {
  if (!bloomDate || gddPerDay <= 0) return null;
  const bloomMs = new Date(bloomDate).getTime();
  if (Number.isNaN(bloomMs)) return null;
  const gddRemaining = Math.max(0, gddToCherry - gddAccumulated);
  // Whole-day terms mirroring the SQL view: `(remaining/rate)::int` rounds to the
  // nearest day, `ceil(stagger)::int` ceils — so the predicted date matches to the
  // day, not merely "close".
  const daysToGdd = Math.round(gddRemaining / gddPerDay);
  const staggerDays = Math.ceil(staggerOffsetDays(altitudeMasl));
  const totalDays = daysToGdd + staggerDays;
  const readyMs = bloomMs + totalDays * MS_PER_DAY;
  return new Date(readyMs).toISOString().slice(0, 10);
}

/** Inputs to the derived readiness score — all signals, no typed flag. */
export interface ReadinessInput {
  /** Accumulated GDD since bloom (from the weather feed). */
  gddAccumulated: number;
  /** GDD required bloom→cherry for this plot's variety. */
  gddToCherry: number;
  /** Plot altitude (masl) — drives the stagger and the confidence note. */
  altitudeMasl: number;
  /** Latest NDVI in [0,1], or null when no satellite signal (degrades to GDD-only). */
  ndviLatest: number | null;
  /** Recent observed ripeness % from harvests, or null (a corroborating signal). */
  recentRipenessPct: number | null;
}

/**
 * DERIVED readiness in [0,1]. The spine is GDD progress toward the bloom→cherry
 * requirement (0 with no heat, 1 once met, clamped). NDVI, when present, nudges
 * the score ±: a greener canopy (NDVI > ~0.6) pulls up, a sparse one pulls down,
 * but it never overrides the GDD spine. NEVER a hand-set "ready" flag.
 */
export function readinessScore(input: ReadinessInput): number {
  const { gddAccumulated, gddToCherry, ndviLatest } = input;
  if (gddToCherry <= 0) return 0;
  const gddProgress = clamp(gddAccumulated / gddToCherry, 0, 1);

  if (ndviLatest === null) return gddProgress;

  // NDVI nudge: centre on 0.6 (healthy canopy), ±0.15 max contribution, weighted
  // so GDD stays the spine. A null NDVI already returned above — this only fires
  // when the satellite signal is actually present.
  const ndviNudge = clamp((ndviLatest - 0.6) / 0.4, -1, 1) * 0.15;
  return clamp(gddProgress + ndviNudge, 0, 1);
}

/** A readiness input tagged with its plot id, for ranking. */
export type RankableReadiness = ReadinessInput & { plotId: string };

/** A ranked plot: its id and its derived readiness score, most-ready first. */
export interface RankedPlot extends RankableReadiness {
  score: number;
}

/**
 * Rank plots most-ready-first — the ordering S5's morning dispatch card reads.
 * Pure: returns a new array, never mutates the input.
 */
export function rankByReadiness(plots: ReadonlyArray<RankableReadiness>): RankedPlot[] {
  return plots
    .map((p) => ({ ...p, score: readinessScore(p) }))
    .sort((a, b) => b.score - a.score);
}

/** Confidence tier for a readiness/ready-date prediction — surfaced, never hidden. */
export type ReadinessConfidence = "high" | "medium" | "low";

/**
 * Honest confidence for a prediction (DESIGN P2-S8: never present a prediction as
 * certainty). High when we have both a bloom date AND a corroborating signal
 * (NDVI or recent ripeness); medium with a bloom date alone; low when GDD-only
 * with no bloom anchor.
 */
export function readinessConfidence(input: {
  hasBloomDate: boolean;
  ndviLatest: number | null;
  recentRipenessPct: number | null;
}): ReadinessConfidence {
  const corroborated = input.ndviLatest !== null || input.recentRipenessPct !== null;
  if (input.hasBloomDate && corroborated) return "high";
  if (input.hasBloomDate) return "medium";
  return "low";
}
