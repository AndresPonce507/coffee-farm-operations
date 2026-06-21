import {
  isISODate,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for calculating a payroll period (P2-S7 — THE PEOPLE-TRUNK
 * CAPSTONE; ADR-002: all writes flow through a single SECURITY DEFINER command RPC).
 *
 * A pure validator (`validateComputePayPeriod`, the friendly-error seam) plus a thin
 * command (`computePayPeriod`) that calls the single write door, `compute_pay_period`.
 * The command takes only the one `.rpc()` method it needs (the `ComputePayPeriodStore`
 * port) so it is testable against a fake store with no database — the SQL CHECK/raise
 * inside the RPC + the make-whole guard on the table are the *real* enforcement; the
 * validation here exists purely to surface friendly errors before the round-trip.
 *
 * The RPC find-or-creates the period then freezes a calculated pay_line per active
 * worker; it is idempotent (re-running a period that already has original lines is a
 * no-op). It returns the period id (a text key like `pp-2026-06-w3`).
 */

/** The recognised hourly-rate sources — mirrors the SQL `p_hourly_rate_source`. */
export const HOURLY_RATE_SOURCES = ["daily"] as const;
export type HourlyRateSource = (typeof HOURLY_RATE_SOURCES)[number];

/** Validated, domain-shaped compute-pay-period args (camelCase). */
export interface ComputePayPeriodInput {
  /** The period key — `p_period_id` (e.g. "pp-2026-06-w3"), non-blank. */
  periodId: string;
  /** Window start — `period_start` (ISO date YYYY-MM-DD). */
  periodStart: string;
  /** Window end — `period_end` (ISO date YYYY-MM-DD, >= start). */
  periodEnd: string;
  /** Optional season label — `season` (nullable). */
  season: string | null;
  /** Where the hourly rate is sourced from — `p_hourly_rate_source` (defaults 'daily'). */
  hourlyRateSource: HourlyRateSource;
}

/**
 * Pure validation of a raw compute-pay-period record — mirrors the
 * `compute_pay_period` DB constraints (including the period_end >= period_start
 * window rule) so errors surface before the round-trip. The SQL CHECK/raise is the
 * actual enforcement (ADR-002).
 */
export function validateComputePayPeriod(
  raw: Record<string, unknown>,
): ValidationResult<ComputePayPeriodInput> {
  const errors: Record<string, string> = {};

  const periodId = trimmed(raw.periodId);
  if (!periodId) errors.periodId = "A period id is required.";

  const periodStart = trimmed(raw.periodStart);
  if (!isISODate(periodStart)) {
    errors.periodStart = "A valid start date is required.";
  }

  const periodEnd = trimmed(raw.periodEnd);
  if (!isISODate(periodEnd)) {
    errors.periodEnd = "A valid end date is required.";
  } else if (isISODate(periodStart) && periodEnd < periodStart) {
    errors.periodEnd = "End date must be on or after the start date.";
  }

  // season is optional.
  const seasonRaw = trimmed(raw.season);
  const season = seasonRaw === "" ? null : seasonRaw;

  // hourlyRateSource defaults to 'daily' (the only source today) when absent/blank.
  const sourceRaw = trimmed(raw.hourlyRateSource) as HourlyRateSource;
  const hourlyRateSource: HourlyRateSource = HOURLY_RATE_SOURCES.includes(sourceRaw)
    ? sourceRaw
    : "daily";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { periodId, periodStart, periodEnd, season, hourlyRateSource },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (period id text → string). */
interface RpcResult {
  data: string | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `compute_pay_period` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface ComputePayPeriodStore {
  rpc(
    fn: "compute_pay_period",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

/** Outcome of the command: the period id, or friendly/labelled errors. */
export type ComputePayPeriodResult =
  | { ok: true; periodId: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Build the snake_case argument envelope the SECURITY DEFINER RPC expects from a
 * validated input. Exported so a caller can build the exact same envelope without
 * re-validating.
 */
export function computePayPeriodRpcArgs(
  input: ComputePayPeriodInput,
): Record<string, unknown> {
  return {
    p_period_id: input.periodId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_season: input.season,
    p_hourly_rate_source: input.hourlyRateSource,
  };
}

/**
 * Validate then calculate: calls `compute_pay_period` exactly once with the
 * snake_case envelope. Bad input never reaches the RPC (friendly errors); RPC
 * failures surface labelled. The RPC is idempotent — re-running a period that
 * already has original lines returns the period id without re-freezing.
 */
export async function computePayPeriod(
  store: ComputePayPeriodStore,
  raw: Record<string, unknown>,
): Promise<ComputePayPeriodResult> {
  const parsed = validateComputePayPeriod(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc(
    "compute_pay_period",
    computePayPeriodRpcArgs(parsed.data),
  );

  if (error) {
    return { ok: false, message: `compute_pay_period: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "compute_pay_period: no period id returned" };
  }
  return { ok: true, periodId: data };
}
