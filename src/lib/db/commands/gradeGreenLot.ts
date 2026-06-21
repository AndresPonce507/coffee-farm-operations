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
  /**
   * The new green node's `lots.code` — SYSTEM IDENTITY, normally minted by the
   * RPC. The form passes none, so this is `""` on the common path and the RPC
   * mints a collision-proof digit-only `JC-NNN`. A non-empty value is only
   * allowed if it already matches the `lots_code_format` CHECK (`^JC-[0-9]{3,}$`)
   * — defense in depth so a malformed code never reaches (and is rejected by) the
   * round-trip the way the old `<source>-G` suggestion did.
   */
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

/**
 * The `lots_code_format` CHECK the green node's code must satisfy: a digit-only
 * `JC-NNN` (3+ digits). Mirrored here so a SUPPLIED code is rejected before the
 * round-trip — the common path supplies NONE and the RPC mints the identity.
 */
const GREEN_CODE_FORMAT = /^JC-[0-9]{3,}$/;

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

  // The green code is system identity, minted server-side — the form supplies
  // NONE (the empty common path). Only a supplied code is validated, and it must
  // match the digit-only `lots_code_format` CHECK (defense in depth: the old
  // `<source>-G` suggestion violated it and broke every grade).
  const greenCode = trimmed(raw.greenCode);
  if (greenCode && !GREEN_CODE_FORMAT.test(greenCode)) {
    errors.greenCode = "A green lot code must look like JC-564 (digits only).";
  }

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
 * Map a raw Postgres error from `materialize_green_lot` onto a family-readable
 * sentence — the SQL trigger/CHECK is the real guard, but the family must never
 * see raw PG text (constraint names, the function name, errcodes). Falls back to
 * a generic "couldn't be graded" line for anything unrecognised, so nothing leaks.
 */
export function friendlyGradeError(raw: string): string {
  const m = raw.toLowerCase();

  // S3 conservation trigger — routing more mass than the source holds.
  if (m.includes("conservation") || m.includes("exceeds") || m.includes("available mass")) {
    return "That's more than the source lot has available. Lower the kilograms and try again.";
  }
  // Unknown / missing source lot (foreign_key_violation raised by the RPC).
  if (m.includes("unknown source") || m.includes("foreign key") || m.includes("foreign_key")) {
    return "That source lot couldn't be found. Pick a milled lot from the list and try again.";
  }
  // Code-format / primary-key / unique collisions on the green node.
  if (
    m.includes("lots_code_format") ||
    m.includes("duplicate key") ||
    m.includes("already exists") ||
    m.includes("unique constraint") ||
    m.includes("primary key")
  ) {
    return "That green lot code can't be used. Leave the code blank so it's assigned automatically.";
  }
  // Any other CHECK / over-route the validator didn't pre-catch.
  if (m.includes("check constraint") || m.includes("violates")) {
    return "Those grade details were rejected. Double-check the kilograms, score, and location.";
  }
  return "This lot couldn't be graded right now. Please check the details and try again.";
}

/**
 * Validate then grade: calls `materialize_green_lot` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures (e.g. the conservation trigger
 * rejecting over-routing) surface as family-readable sentences (`friendlyGradeError`)
 * — raw Postgres text never leaks.
 *
 * The green code is SYSTEM IDENTITY: the form supplies none, so this passes
 * `p_green_code: null` and the RPC mints a collision-proof digit-only `JC-NNN`,
 * returning it (the command surfaces the minted code). Because the code is
 * server-minted, a fresh submit mints a NEW code — exactly-once is only on a
 * SUPPLIED code; the form mitigates double-submit with a stable idempotency token
 * + the disabled-during-pending guard.
 */
export async function gradeGreenLot(
  store: GradeGreenLotStore,
  raw: Record<string, unknown>,
): Promise<GradeGreenLotResult> {
  const parsed = validateGradeGreenLot(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("materialize_green_lot", {
    p_source_code: parsed.data.sourceCode,
    // Pass null on the common path so the RPC MINTS a digit-only JC-NNN identity
    // (a blank/`""` would also coalesce server-side, but null is the clean intent).
    p_green_code: parsed.data.greenCode || null,
    p_kg: parsed.data.kg,
    p_cupping_score: parsed.data.cuppingScore,
    p_location: parsed.data.location,
    p_occurred_at: parsed.data.occurredAt,
  });

  if (error) {
    return { ok: false, message: friendlyGradeError(error.message) };
  }
  if (!data) {
    return {
      ok: false,
      message: "This lot couldn't be graded right now. Please try again.",
    };
  }
  return { ok: true, greenLotCode: data };
}
