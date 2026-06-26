import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the roast FINALIZE keystone (P3-S10 — roasting; ADR-002 —
 * every write flows through a SECURITY DEFINER command RPC). The single write door is
 * `finalize_roast_batch`, which in ONE txn:
 *   1. validates roasted-out ≤ green-in (roasting only loses mass),
 *   2. mints the roasted `lots` node (stage='roasted') off the shared lot_code_seq,
 *   3. routes the CONSERVED 'roast' lot_edge green→roasted (the Phase-1
 *      `lot_edges_conserve_mass` trigger rejects routing more green than exists — the
 *      mass guarantee REUSED, never rebuilt),
 *   4. posts a processing-batch `cost_entry` so roast cost flows into `cogs_per_lot`,
 *      then `refresh_lot_cost()`,
 *   5. appends `roast_finalized` to the hash chain.
 * It RETURNS the minted roasted lot code (text) and is idempotent on the batch: a
 * replayed finalize returns the SAME code with no second mint / cost row.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the single `.rpc()` it needs (the `FinalizeRoastBatchStore` port), testable against
 * a fake store with no database — the mass-loss / conservation / status guards are the
 * REAL enforcement; this command translates their rejections into clean, family-
 * readable sentences. The roast cost + location are OPTIONAL (blank forwards null — the
 * RPC coalesces cost to 0 and posts no cost row; location is event metadata); the
 * idempotency key is REQUIRED.
 */

/** Validated, domain-shaped finalize args (camelCase). */
export interface FinalizeRoastBatchInput {
  /** The open roast batch to finalize (`roast_batches.id`, positive integer). */
  batchId: number;
  /** Roasted mass out (kg, > 0) — minted into the roasted node (≤ green-in). */
  roastedKgOut: number;
  /** Roast cost to fold into COGS (USD, ≥ 0); null ⇒ the RPC posts NO cost row. */
  roastCostUsd: number | null;
  /** Where the roasted bags are stored (event metadata); null ⇒ not declared. */
  location: string | null;
  /** Exactly-once anchor — the DB dedupes on the batch + a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw finalize — mirrors the `finalize_roast_batch` /
 * `roast_batches` constraints (positive batch id + roasted-out, non-negative cost) so
 * errors surface before the round-trip. The mass-loss ceiling + the conservation guard
 * are the actual enforcement (ADR-002).
 */
export function validateFinalizeRoastBatch(
  raw: Record<string, unknown>,
): ValidationResult<FinalizeRoastBatchInput> {
  const errors: Record<string, string> = {};

  const batchId = toNumber(raw.batchId);
  if (batchId === null || !Number.isInteger(batchId) || batchId <= 0) {
    errors.batchId = "Choose a roast batch to finalize.";
  }

  const roastedKgOut = toNumber(raw.roastedKgOut);
  if (roastedKgOut === null || roastedKgOut <= 0) {
    errors.roastedKgOut = "Roasted output (kg) must be greater than 0.";
  }

  // Roast cost is optional; if supplied it must be ≥ 0 (blank ⇒ no cost row).
  let roastCostUsd: number | null = null;
  if (!isBlank(raw.roastCostUsd)) {
    const c = toNumber(raw.roastCostUsd);
    if (c === null || c < 0) {
      errors.roastCostUsd = "Roast cost must be 0 or more.";
    } else {
      roastCostUsd = c;
    }
  }

  // Location is optional (event metadata only); blank ⇒ null.
  const rawLocation = trimmed(raw.location);
  const location: string | null = rawLocation || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      batchId: batchId as number,
      roastedKgOut: roastedKgOut as number,
      roastCostUsd,
      location,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (the minted roasted code). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `finalize_roast_batch` needs. */
export interface FinalizeRoastBatchStore {
  rpc(
    fn: "finalize_roast_batch",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the minted roasted lot code, or friendly/labelled errors. */
export type FinalizeRoastBatchResult =
  | { ok: true; roastedLotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `finalize_roast_batch` onto a family-readable
 * sentence — the mass-loss / conservation / status guards are the real enforcement,
 * but the family must never see raw PG text (function names, errcodes). Always returns
 * a clean sentence. Ordering matters: the mass-loss raise contains "cannot exceed", so
 * it is matched (with "roasting only loses mass") BEFORE the conservation branch.
 */
export function friendlyFinalizeRoastBatchError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();

  // (1) Mass-loss ceiling — roasted out exceeds green in (roasting only loses mass).
  if (m.includes("roasting only loses mass") || m.includes("cannot exceed green")) {
    return "Roasted output can't be more than the green that went in — roasting only loses mass. Re-check the weight.";
  }
  // (2) Phase-1 conservation trigger — routing more green than the lot holds.
  if (
    m.includes("conservation") ||
    m.includes("available mass") ||
    m.includes("conserve")
  ) {
    return "That's more green than the lot holds. Re-check the batch and try again.";
  }
  // (3) The batch isn't open (already finalized).
  if (
    m.includes("only an open batch") ||
    m.includes("is finalized") ||
    m.includes("already") ||
    m.includes("not open")
  ) {
    return "This roast batch has already been finalized (or isn't open). Refresh and check its status.";
  }
  // (4) Unknown / missing roast batch.
  if (
    error.code === "23503" ||
    m.includes("unknown roast batch") ||
    m.includes("foreign key")
  ) {
    return "That roast batch couldn't be found. Pick an open batch and try again.";
  }
  return "This roast batch couldn't be finalized right now. Please check the details and try again.";
}

/**
 * Validate then finalize: calls `finalize_roast_batch` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the data-layer
 * guards (mass-loss, conservation, non-open batch, unknown batch) surface as CLEAN,
 * family-readable sentences — raw Postgres text never leaks. Returns the MINTED roasted
 * lot code. Idempotent on the batch: a replayed finalize returns the same code.
 */
export async function finalizeRoastBatch(
  store: FinalizeRoastBatchStore,
  raw: Record<string, unknown>,
): Promise<FinalizeRoastBatchResult> {
  const parsed = validateFinalizeRoastBatch(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("finalize_roast_batch", {
    p_batch_id: parsed.data.batchId,
    p_roasted_kg_out: parsed.data.roastedKgOut,
    p_roast_cost_usd: parsed.data.roastCostUsd,
    p_location: parsed.data.location,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyFinalizeRoastBatchError(error) };
  }
  if (!data) {
    return {
      ok: false,
      message: "This roast batch couldn't be finalized right now. Please try again.",
    };
  }
  return { ok: true, roastedLotCode: data };
}
