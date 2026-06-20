import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for GreenLot grading (S5 — the first money-shaped slice;
 * ADR-002 — all writes flow through a `SECURITY DEFINER` command RPC, one per
 * business intent).
 *
 * Grading a finished lot promotes it into a located, available-to-promise
 * sellable asset. The single write door is `materialize_green_lot` — the ONLY
 * GreenLot writer: it creates the green `lots` node (same graph node at
 * stage='green'), routes mass from the source node via one CONSERVED 'process'
 * `lot_edge` (the S3 conservation trigger rejects routing more than the source
 * holds), and writes the `green_lots` detail row (cupping score + location; the
 * `sca_grade` band is GENERATED). It is idempotent on the green code — a replay
 * is a no-op returning the code, so a retry never double-routes mass.
 *
 * This command is the symmetric twin of the read ports in `src/lib/db/*.ts`: a
 * pure validator (`validateGradeGreenLot`, the friendly-error seam) plus a thin
 * command (`gradeGreenLot`) that calls the single `.rpc()` method it needs (the
 * `GradeGreenLotStore` port) so it is testable against a fake store with no
 * database — the SQL conservation trigger + CHECKs are the *real* enforcement;
 * the validation here exists purely to surface friendly errors before the
 * round-trip. Mirrors the `@/lib/validation/*` `ValidationResult` contract
 * (the repo's friendly-error convention; zod is not a project dependency).
 */

/** Validated, domain-shaped grade args (camelCase). */
export interface GradeGreenLotInput {
  /** The source `lots.code` whose mass is routed into the green node. */
  sourceCode: string;
  /** The new green node's `lots.code` (JC-NNN-G traceability code). */
  greenCode: string;
  /** Mass (kg) to route from source → green via the conserved 'process' edge. */
  kg: number;
  /** Measured cupping score (0–100) — the grade input that bands `sca_grade`. */
  cuppingScore: number;
  /** Warehouse / storage location of the graded green lot. */
  location: string;
  /** Field wall-clock — `occurred_at`, carried onto the node + edge + detail row. */
  occurredAt: string;
}

/** Is `v` a recognised, ISO-8601 timestamp (e.g. "2026-06-20T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw grade (form record or object) — mirrors the
 * `materialize_green_lot` / `green_lots` DB constraints so errors surface before
 * the round-trip. The SQL conservation trigger + CHECKs are the actual
 * enforcement (ADR-002).
 */
export function validateGradeGreenLot(
  raw: Record<string, unknown>,
): ValidationResult<GradeGreenLotInput> {
  const errors: Record<string, string> = {};

  const sourceCode = trimmed(raw.sourceCode);
  if (!sourceCode) errors.sourceCode = "Choose a source lot.";

  const greenCode = trimmed(raw.greenCode);
  if (!greenCode) errors.greenCode = "A green lot code is required.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) {
    errors.kg = "Mass (kg) must be greater than 0.";
  }

  const cuppingScore = toNumber(raw.cuppingScore);
  if (cuppingScore === null) {
    errors.cuppingScore = "A cupping score is required.";
  } else if (cuppingScore < 0 || cuppingScore > 100) {
    errors.cuppingScore = "Cupping score must be between 0 and 100.";
  }

  const location = trimmed(raw.location);
  if (!location) errors.location = "A storage location is required.";

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid grading time is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      sourceCode,
      greenCode,
      kg: kg as number,
      cuppingScore: cuppingScore as number,
      location,
      occurredAt,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()`. */
interface RpcResult {
  data: string | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `materialize_green_lot` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface GradeGreenLotStore {
  rpc(
    fn: "materialize_green_lot",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

/** Outcome of the command: the green lot code, or friendly/labelled errors. */
export type GradeGreenLotResult =
  | { ok: true; greenLotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then grade: calls `materialize_green_lot` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures (e.g. the conservation trigger
 * rejecting over-routing) surface labelled. The RPC is idempotent on the green
 * code — a replay returns the originally-materialized code with no second edge
 * and no double-routed mass.
 */
export async function gradeGreenLot(
  store: GradeGreenLotStore,
  raw: Record<string, unknown>,
): Promise<GradeGreenLotResult> {
  const parsed = validateGradeGreenLot(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("materialize_green_lot", {
    p_source_code: parsed.data.sourceCode,
    p_green_code: parsed.data.greenCode,
    p_kg: parsed.data.kg,
    p_cupping_score: parsed.data.cuppingScore,
    p_location: parsed.data.location,
    p_occurred_at: parsed.data.occurredAt,
  });

  if (error) {
    return { ok: false, message: `materialize_green_lot: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      message: "materialize_green_lot: no green lot code returned",
    };
  }
  return { ok: true, greenLotCode: data };
}
