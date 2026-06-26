import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the milling-run FINALIZE keystone (P3-S9 — finalize milling
 * + green grade + COGS flow; ADR-002 — all writes flow through a SECURITY DEFINER
 * command RPC). The single write door is `finalize_milling_run`, which in ONE txn:
 *   1. records the green outturn + validates the CLOSED OUTTURN MASS BALANCE (an
 *      18%-vanished run is physically rejected and the whole txn rolls back),
 *   2. CALLS the canonical `materialize_green_lot` to mint the green node via the
 *      existing conserved 'process' lot_edge (the Phase-1 conservation trigger
 *      rejects minting more green than the parchment holds — the money/mass guarantee
 *      is REUSED, never rebuilt),
 *   3. posts a processing-batch `cost_entry` so milling cost flows into
 *      `cogs_per_lot`, then `refresh_lot_cost()`,
 *   4. auto-grades the green (`mill_grade`, the GENERATED prep band),
 *   5. appends `mill_run_finalized` to the hash chain.
 * It RETURNS the minted green lot code (text) and is idempotent on the green code: a
 * replayed finalize returns the SAME code with no second mint / cost row.
 *
 * Symmetric twin of the read ports: a pure validator (`validateFinalizeMillingRun`,
 * the friendly-error seam) plus a thin command (`finalizeMillingRun`) that calls the
 * single `.rpc()` it needs (the `FinalizeMillingRunStore` port) so it is testable
 * against a fake store with no database — the mass-balance / conservation / status
 * guards are the REAL enforcement; this command translates their rejections into
 * clean, family-readable sentences. The processing cost + screen size are OPTIONAL
 * (blank forwards null — the RPC coalesces cost to 0 and posts no cost row); the
 * idempotency key is REQUIRED.
 */

/** Validated, domain-shaped finalize args (camelCase). */
export interface FinalizeMillingRunInput {
  /** The open milling run to finalize (`milling_runs.id`, a positive integer). */
  runId: number;
  /** Authoritative green outturn (kg, > 0) — the mass minted into the green node. */
  greenKgOut: number;
  /** Measured cupping score (0–100) — carried onto the minted green lot. */
  cuppingScore: number;
  /** Warehouse / storage location of the minted green lot. */
  location: string;
  /** Category-1 (primary) full-defect count for the auto-grade (≥ 0, integer). */
  cat1Defects: number;
  /** Category-2 (secondary) full-defect count for the auto-grade (≥ 0, integer). */
  cat2Defects: number;
  /** Screen size (≥ 0, integer); null ⇒ not declared (the RPC's nullable arg). */
  screenSize: number | null;
  /** Milling cost to fold into COGS (USD, ≥ 0); null ⇒ the RPC posts NO cost row. */
  processingCostUsd: number | null;
  /** Exactly-once anchor — the DB dedupes on the run + a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** A non-negative integer (the `integer` defect/screen columns + the `>= 0` CHECKs)? */
function isNonNegInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Pure validation of a raw finalize — mirrors the `finalize_milling_run` /
 * `materialize_green_lot` / `green_lots` constraints (positive run id + outturn,
 * cupping 0–100, non-negative integer defects/screen, non-negative cost) so errors
 * surface before the round-trip. The mass-balance + conservation guards are the
 * actual enforcement (ADR-002).
 */
export function validateFinalizeMillingRun(
  raw: Record<string, unknown>,
): ValidationResult<FinalizeMillingRunInput> {
  const errors: Record<string, string> = {};

  const runId = toNumber(raw.runId);
  if (runId === null || !Number.isInteger(runId) || runId <= 0) {
    errors.runId = "Choose a milling run to finalize.";
  }

  const greenKgOut = toNumber(raw.greenKgOut);
  if (greenKgOut === null || greenKgOut <= 0) {
    errors.greenKgOut = "Green outturn (kg) must be greater than 0.";
  }

  const cuppingScore = toNumber(raw.cuppingScore);
  if (cuppingScore === null) {
    errors.cuppingScore = "A cupping score is required.";
  } else if (cuppingScore < 0 || cuppingScore > 100) {
    errors.cuppingScore = "Cupping score must be between 0 and 100.";
  }

  const location = trimmed(raw.location);
  if (!location) errors.location = "A storage location is required.";

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

  // Processing cost is optional; if supplied it must be ≥ 0 (blank ⇒ no cost row).
  let processingCostUsd: number | null = null;
  if (!isBlank(raw.processingCostUsd)) {
    const c = toNumber(raw.processingCostUsd);
    if (c === null || c < 0) {
      errors.processingCostUsd = "Processing cost must be 0 or more.";
    } else {
      processingCostUsd = c;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      runId: runId as number,
      greenKgOut: greenKgOut as number,
      cuppingScore: cuppingScore as number,
      location,
      cat1Defects: cat1Defects as number,
      cat2Defects: cat2Defects as number,
      screenSize,
      processingCostUsd,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (the minted green code). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `finalize_milling_run` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface FinalizeMillingRunStore {
  rpc(
    fn: "finalize_milling_run",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the minted green lot code, or friendly/labelled errors. */
export type FinalizeMillingRunResult =
  | { ok: true; greenLotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `finalize_milling_run` onto a family-readable
 * sentence — the mass-balance / conservation / status guards are the real enforcement,
 * but the family must never see raw PG text (function names, the engine's
 * "per-variety ceiling" prefix, errcodes). Falls back to a generic line for anything
 * unrecognised so nothing leaks. Ordering matters: the mass-balance message itself
 * ends "…cannot finalize", so it is matched BEFORE the already-finalized branch.
 */
export function friendlyFinalizeMillingRunError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();

  // (1) Closed outturn mass-balance rejected (the spike's "weight-loss mystery").
  if (m.includes("mass-balance") || m.includes("unbalanc")) {
    return "That outturn doesn't balance against what went into the mill. Record the byproducts/rejects or re-weigh the green, then finalize.";
  }
  // (2) Phase-1 conservation trigger — minting more green than the parchment holds.
  if (
    m.includes("conservation") ||
    m.includes("exceeds") ||
    m.includes("available mass")
  ) {
    return "That's more green than the parchment lot holds. Re-check the outturn weight and try again.";
  }
  // (3) The run isn't open (already finalized / cancelled).
  if (
    m.includes("only an open run") ||
    m.includes("already") ||
    m.includes("is finalized") ||
    m.includes("not open")
  ) {
    return "This milling run has already been finalized (or isn't open). Refresh and check its status.";
  }
  // (4) Unknown / missing milling run (foreign_key_violation raised by the RPC).
  if (
    error.code === "23503" ||
    m.includes("unknown milling run") ||
    m.includes("foreign key") ||
    m.includes("foreign_key")
  ) {
    return "That milling run couldn't be found. Pick an open run and try again.";
  }
  return "This run couldn't be finalized right now. Please check the details and try again.";
}

/**
 * Validate then finalize: calls `finalize_milling_run` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); the data-layer guards (mass-balance,
 * conservation, non-open run, unknown run) surface as CLEAN, family-readable
 * sentences — raw Postgres text never leaks. Returns the MINTED green lot code.
 * Idempotent on the green code: a replayed finalize returns the same code.
 */
export async function finalizeMillingRun(
  store: FinalizeMillingRunStore,
  raw: Record<string, unknown>,
): Promise<FinalizeMillingRunResult> {
  const parsed = validateFinalizeMillingRun(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("finalize_milling_run", {
    p_run_id: parsed.data.runId,
    p_green_kg_out: parsed.data.greenKgOut,
    p_cupping_score: parsed.data.cuppingScore,
    p_location: parsed.data.location,
    p_cat1_defects: parsed.data.cat1Defects,
    p_cat2_defects: parsed.data.cat2Defects,
    p_screen_size: parsed.data.screenSize,
    p_processing_cost_usd: parsed.data.processingCostUsd,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyFinalizeMillingRunError(error) };
  }
  if (!data) {
    return {
      ok: false,
      message: "This run couldn't be finalized right now. Please try again.",
    };
  }
  return { ok: true, greenLotCode: data };
}
