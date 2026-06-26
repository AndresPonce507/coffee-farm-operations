import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for appending an SCA green grade (P3-S9 — finalize milling +
 * green grade + COGS flow; ADR-002 — all writes flow through a SECURITY DEFINER
 * command RPC). The single write door is `record_green_grade` — tenant-clamped,
 * idempotent on a tenant-qualified key, appending a `green_graded` lot_event in the
 * same txn. The `mill_grade` ledger is APPEND-ONLY (the immutability trigger rejects
 * UPDATE/DELETE): a re-grade is a NEW row; the latest wins via `v_green_grade`. The
 * `sca_prep` band is a GENERATED column the DB computes from the defect counts — the
 * client NEVER sets it, so the grade can't drift from its defects.
 *
 * This is the standalone re-grade / late-grade path; `finalize_milling_run` also
 * auto-grades inline at finalize time. Symmetric twin of the read ports: a pure
 * validator (`validateRecordGreenGrade`, the friendly-error seam) plus a thin
 * command (`recordGreenGrade`) that calls the single `.rpc()` it needs (the
 * `RecordGreenGradeStore` port) so it is testable against a fake store with no
 * database. The screen size is OPTIONAL (blank forwards null); the idempotency key
 * is REQUIRED.
 */

/** Validated, domain-shaped grade args (camelCase). */
export interface RecordGreenGradeInput {
  /** The green lot being graded (`lots.code` at stage='green'). */
  greenLotCode: string;
  /** Category-1 (primary) full-defect-equivalent count (≥ 0, integer). */
  cat1Defects: number;
  /** Category-2 (secondary) full-defect-equivalent count (≥ 0, integer). */
  cat2Defects: number;
  /** Screen size (≥ 0, integer); null ⇒ not declared (the RPC's nullable arg). */
  screenSize: number | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** A non-negative integer (the `integer` columns + the `>= 0` CHECKs)? */
function isNonNegInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Pure validation of a raw grade — mirrors the `record_green_grade` / `mill_grade`
 * constraints (defect counts are non-negative integers, screen size ≥ 0) so errors
 * surface before the round-trip. The append-only trigger, tenant clamp, and the
 * GENERATED prep band are the actual enforcement (ADR-002).
 */
export function validateRecordGreenGrade(
  raw: Record<string, unknown>,
): ValidationResult<RecordGreenGradeInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot to grade.";

  const cat1Defects = toNumber(raw.cat1Defects);
  if (cat1Defects === null || !isNonNegInt(cat1Defects)) {
    errors.cat1Defects = "Primary defects must be a whole number, 0 or more.";
  }

  const cat2Defects = toNumber(raw.cat2Defects);
  if (cat2Defects === null || !isNonNegInt(cat2Defects)) {
    errors.cat2Defects = "Secondary defects must be a whole number, 0 or more.";
  }

  // Screen size is optional; if supplied it must be a non-negative integer.
  let screenSize: number | null = null;
  if (!isBlank(raw.screenSize)) {
    const s = toNumber(raw.screenSize);
    if (s === null || !isNonNegInt(s)) {
      errors.screenSize = "Screen size must be a whole number, 0 or more.";
    } else {
      screenSize = s;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      cat1Defects: cat1Defects as number,
      cat2Defects: cat2Defects as number,
      screenSize,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint grade id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_green_grade` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RecordGreenGradeStore {
  rpc(
    fn: "record_green_grade",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the appended grade's id, or friendly/labelled errors. */
export type RecordGreenGradeResult =
  | { ok: true; gradeId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_green_grade` onto a family-readable
 * sentence — the RPC is the real guard, but the family must never see raw PG text
 * (function names, errcodes). Falls back to a generic line for anything unrecognised
 * so nothing leaks.
 */
export function friendlyRecordGreenGradeError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();
  // Unknown / non-green source lot (foreign_key_violation raised by the RPC).
  if (
    error.code === "23503" ||
    m.includes("unknown green lot") ||
    m.includes("foreign key") ||
    m.includes("foreign_key")
  ) {
    return "That green lot couldn't be found. Pick a green lot from the list and try again.";
  }
  return "This grade couldn't be recorded right now. Please check the details and try again.";
}

/**
 * Validate then record: calls `record_green_grade` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); an RPC failure surfaces as a clean, family-readable sentence
 * (raw Postgres text never leaks). Exactly-once on `idempotencyKey` — a replay
 * returns the same grade id with no second row.
 */
export async function recordGreenGrade(
  store: RecordGreenGradeStore,
  raw: Record<string, unknown>,
): Promise<RecordGreenGradeResult> {
  const parsed = validateRecordGreenGrade(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_green_grade", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_cat1_defects: parsed.data.cat1Defects,
    p_cat2_defects: parsed.data.cat2Defects,
    p_screen_size: parsed.data.screenSize,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyRecordGreenGradeError(error) };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This grade couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, gradeId: Number(data) };
}
