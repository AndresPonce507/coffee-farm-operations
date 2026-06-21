import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for the CERT/PHI-safe spray log (P2-S12, ADR-002 — all writes
 * flow through a SECURITY DEFINER command RPC). This is the slice's keystone: a
 * spray is BLOCKED at the data layer unless the applicator holds a VALID
 * pesticide-handling cert (S1's v_worker_certs_valid) AND no active re-entry window
 * is violated — the SQL `log_spray` RAISES, fail-closed. This module is the thin,
 * pure write seam: a friendly validator + a command that calls the single write
 * door, and that surfaces the DB cert-gate refusal as a clear, labelled error.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** A valid ISO timestamp (date or date-time) — mirrors recordMoisture's helper. */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

/** Validated, domain-shaped spray args (camelCase). */
export interface SprayInput {
  plotId: string;
  product: string;
  /** The active ingredient — nullable but recommended for the PHI dossier. */
  activeIngredient: string | null;
  /** Pre-harvest interval in days (>= 0; default 0). */
  phiDays: number;
  /** Re-entry interval in hours (>= 0; default 0). */
  reiHours: number;
  /** When it was applied — `applied_at` (ISO timestamp, required). */
  appliedAt: string;
  /** The applicator — the cert-gated worker (`worker_id`, required). */
  workerId: string;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw spray record — mirrors the `log_spray` DB constraints
 * (non-negative intervals, required applicator) so obvious errors surface before
 * the round-trip. The SQL cert + PHI/REI gate is the ACTUAL enforcement (ADR-002):
 * a UI cannot bypass it, and a refusal still surfaces as a labelled error.
 */
export function validateSpray(
  raw: Record<string, unknown>,
): ValidationResult<SprayInput> {
  const errors: Record<string, string> = {};

  const plotId = trimmed(raw.plotId);
  if (!plotId) errors.plotId = "Choose a plot.";

  const product = trimmed(raw.product);
  if (!product) errors.product = "A product is required.";

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose the applicator (must hold a valid cert).";

  // PHI/REI default to 0 when absent; when present they must be non-negative.
  const phiRaw = raw.phiDays;
  let phiDays = 0;
  if (phiRaw !== undefined && phiRaw !== null && phiRaw !== "") {
    const n = toNumber(phiRaw);
    if (n === null || n < 0) errors.phiDays = "PHI days must be 0 or more.";
    else phiDays = n;
  }

  const reiRaw = raw.reiHours;
  let reiHours = 0;
  if (reiRaw !== undefined && reiRaw !== null && reiRaw !== "") {
    const n = toNumber(reiRaw);
    if (n === null || n < 0) errors.reiHours = "REI hours must be 0 or more.";
    else reiHours = n;
  }

  const appliedAt = trimmed(raw.appliedAt);
  if (!isISOTimestamp(appliedAt)) {
    errors.appliedAt = "A valid application time is required.";
  }

  const aiRaw = trimmed(raw.activeIngredient);
  const activeIngredient = aiRaw === "" ? null : aiRaw;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      plotId,
      product,
      activeIngredient,
      phiDays,
      reiHours,
      appliedAt,
      workerId,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint → number). */
interface RpcResult {
  data: number | null;
  error: { message: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `log_spray` needs. */
export interface SprayStore {
  rpc(fn: "log_spray", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the spray id, or friendly/labelled errors. */
export type SprayResult =
  | { ok: true; sprayId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then log: calls `log_spray` exactly once with the snake_case envelope
 * the SECURITY DEFINER RPC expects. Bad input never reaches the RPC; a DB cert-gate
 * or PHI/REI refusal surfaces as a labelled error the UI shows the user. The RPC is
 * exactly-once on `idempotencyKey`.
 */
export async function logSpray(
  store: SprayStore,
  raw: Record<string, unknown>,
): Promise<SprayResult> {
  const parsed = validateSpray(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("log_spray", {
    p_plot_id: parsed.data.plotId,
    p_product: parsed.data.product,
    p_active_ingredient: parsed.data.activeIngredient,
    p_phi_days: parsed.data.phiDays,
    p_rei_hours: parsed.data.reiHours,
    p_applied_at: parsed.data.appliedAt,
    p_worker_id: parsed.data.workerId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: error.message };
  if (data === null || data === undefined) {
    return { ok: false, message: "log_spray: no spray id returned" };
  }
  return { ok: true, sprayId: data };
}
