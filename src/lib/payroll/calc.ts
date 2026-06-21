/**
 * P2-S7 · Payroll — the pure, DB-free mirror of the blended piece-rate + hourly
 * pay math with the MIN-WAGE MAKE-WHOLE GUARD and Panama statutory withholding.
 *
 * THE DATABASE IS THE REAL ENFORCEMENT. The make-whole floor is un-bypassable in
 * Postgres (a BEFORE-INSERT trigger reasserts the floor from the canonical
 * `farm_season_config`, then STORED GENERATED columns compute make-whole / gross /
 * net, with a `gross_usd >= min_wage_floor_usd` CHECK as the fail-closed backstop).
 * See `supabase/migrations/20260622108000_payroll.sql`.
 *
 * This module exists so the cockpit can PREVIEW a pay line; the floor/make-whole/
 * gross/net FORMULAS mirror the SQL exactly, so a preview's take-home matches what the
 * DB stores:
 *   - floor      = round2(hours × min-wage hourly)            ← the floor trigger
 *   - make_whole = max(0, floor − (piece + hourly))           ← generated column
 *   - gross      = piece + hourly + make_whole                ← generated column
 *   - withholding= round2(gross × pct / 100)  (per rate)      ← see base note below
 *   - net        = gross − css − seguro   (décimo EXCLUDED)   ← generated column
 *
 * ⚠️ ONE DELIBERATE DIVERGENCE — the WITHHOLDING BASE. This module's
 * `statutoryWithholding`/`computePayLine` apply the rates to the make-whole-INCLUSIVE
 * gross, whereas the v1 `compute_pay_period` RPC applies them to the PRE-make-whole
 * blended gross (piece + hourly). For a worker the floor lifted, the two differ by a
 * few cents. This is a flagged, accountant-confirmation choice (DESIGN §4.1): the
 * RPC's frozen figures are authoritative; treat this module's withholding as an
 * indicative preview for topped-up workers, not cent-exact. The floor/gross/net
 * mirror is exact for all workers.
 *
 * Pure: every function takes/returns plain numbers/objects with no side effects, so
 * the whole module is exhaustively unit-testable at $0.
 */

/**
 * Round a money value to 2 decimals without binary-float drift. Mirrors Postgres
 * `round(x, 2)`: `Math.round((x + ε) × 100) / 100` nudges past the float
 * representation error (e.g. 1.005 stored as 1.00499… rounds correctly to 1.01).
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The legal minimum-wage floor for the hours worked = round2(hours × hourly rate).
 * Mirrors the `pay_line_enforce_floor` trigger: `round(hours_worked × min_wage_hourly_usd, 2)`.
 * Negative inputs clamp to 0 — a floor is never negative (and a reversal owes none).
 */
export function minWageFloor(hoursWorked: number, minWageHourlyUsd: number): number {
  const hours = Math.max(0, hoursWorked);
  const rate = Math.max(0, minWageHourlyUsd);
  return round2(hours * rate);
}

/**
 * THE MAKE-WHOLE — the legal-minimum top-up. `max(0, floor − (piece + hourly))`,
 * rounded to cents. Mirrors the `make_whole_usd` generated column:
 * `greatest(0, min_wage_floor_usd − (piece_rate_usd + hourly_usd))`.
 *
 * A worker BELOW the floor is topped up exactly to it; a worker AT or ABOVE the
 * floor gets ZERO (never a clawback). This is the CRIT invariant — it is impossible
 * for blended earnings + make-whole to fall below the legal floor.
 */
export function makeWhole(pieceRateUsd: number, hourlyUsd: number, floorUsd: number): number {
  return round2(Math.max(0, floorUsd - (pieceRateUsd + hourlyUsd)));
}

/**
 * Gross pay = blended earnings + the make-whole top-up, rounded to cents. Mirrors
 * the `gross_usd` generated column:
 * `piece_rate_usd + hourly_usd + greatest(0, floor − (piece + hourly))`.
 * For a below-floor worker this equals the floor exactly; above the floor it is
 * just piece + hourly (no top-up).
 */
export function gross(pieceRateUsd: number, hourlyUsd: number, floorUsd: number): number {
  return round2(pieceRateUsd + hourlyUsd + makeWhole(pieceRateUsd, hourlyUsd, floorUsd));
}

/** The Panama employee-share statutory rates (percent), versioned in `statutory_rates`. */
export interface StatutoryRates {
  /** Caja de Seguro Social, employee share (≈ 9.75%). */
  cssEmployeePct: number;
  /** Seguro Educativo, employee share (≈ 1.25%). */
  seguroEducativoPct: number;
  /** Décimo (13th-month) ACCRUAL on gross (≈ 8.33% = 1/12) — tracked, not deducted in-period. */
  decimoAccrualPct: number;
}

/** The three statutory figures derived from a gross, each rounded to cents. */
export interface StatutoryWithholding {
  cssUsd: number;
  seguroEducativoUsd: number;
  decimoAccrualUsd: number;
}

/**
 * Apply the statutory rates to a gross: each figure = round2(gross × pct / 100).
 * Mirrors `compute_pay_period`'s `round(base × pct / 100.0, 2)` per rate. The décimo
 * is an ACCRUAL (tracked for the 13th-month payout), not an in-period deduction.
 */
export function statutoryWithholding(
  grossUsd: number,
  rates: StatutoryRates,
): StatutoryWithholding {
  return {
    cssUsd: round2((grossUsd * rates.cssEmployeePct) / 100),
    seguroEducativoUsd: round2((grossUsd * rates.seguroEducativoPct) / 100),
    decimoAccrualUsd: round2((grossUsd * rates.decimoAccrualPct) / 100),
  };
}

/**
 * Net take-home = gross − CSS − Seguro Educativo, rounded to cents. The décimo
 * accrual is DELIBERATELY excluded (it is paid out separately as the 13th month),
 * matching the `net_usd` generated column:
 * `… − css_usd − seguro_educativo_usd` (no `decimo_accrual_usd` term).
 */
export function netPay(grossUsd: number, cssUsd: number, seguroEducativoUsd: number): number {
  return round2(grossUsd - cssUsd - seguroEducativoUsd);
}

/** The inputs needed to compute one pay line (the blended earnings + the rate context). */
export interface PayLineInput {
  /** Σ kg × por-obra rate — the piece-rate earnings. */
  pieceRateUsd: number;
  /** Σ hours × hourly rate — the hourly earnings. */
  hourlyUsd: number;
  /** Hours worked in the period (drives the legal floor). */
  hoursWorked: number;
  /** The canonical minimum-wage hourly rate (from `farm_season_config`). */
  minWageHourlyUsd: number;
  /** The effective Panama statutory rates for the period. */
  rates: StatutoryRates;
}

/** A fully-composed pay line — the same breakdown the DB freezes on a `pay_line` row. */
export interface PayLine {
  floorUsd: number;
  makeWholeUsd: number;
  grossUsd: number;
  cssUsd: number;
  seguroEducativoUsd: number;
  decimoAccrualUsd: number;
  netUsd: number;
  /** True when the make-whole top-up fired (the cockpit's highlight signal). */
  madeWhole: boolean;
}

/**
 * Compose the full pay line end-to-end — the pure mirror of what `compute_pay_period`
 * + the `pay_line` generated columns produce for one worker. Withholdings are
 * computed on the make-whole-inclusive gross (the figure stored on the row); net
 * excludes the décimo accrual. `madeWhole` flags whether the floor protected the
 * worker (make-whole > 0).
 */
export function computePayLine(input: PayLineInput): PayLine {
  const floorUsd = minWageFloor(input.hoursWorked, input.minWageHourlyUsd);
  const makeWholeUsd = makeWhole(input.pieceRateUsd, input.hourlyUsd, floorUsd);
  const grossUsd = gross(input.pieceRateUsd, input.hourlyUsd, floorUsd);
  const { cssUsd, seguroEducativoUsd, decimoAccrualUsd } = statutoryWithholding(
    grossUsd,
    input.rates,
  );
  const netUsd = netPay(grossUsd, cssUsd, seguroEducativoUsd);

  return {
    floorUsd,
    makeWholeUsd,
    grossUsd,
    cssUsd,
    seguroEducativoUsd,
    decimoAccrualUsd,
    netUsd,
    madeWhole: makeWholeUsd > 0,
  };
}
