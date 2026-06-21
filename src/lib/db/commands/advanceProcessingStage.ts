import type { BatchStage } from "@/lib/types";
import { BATCH_STAGES } from "@/lib/enums";
import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for advancing a processing lot through the pipeline (the
 * PROCESS-ADVANCE slice; ADR-002 — all writes flow through a `SECURITY DEFINER`
 * command RPC, one per business intent).
 *
 * Advancing moves a lot one step along cherry → fermentation → drying →
 * parchment → milled → green, recording the mass that survives that step
 * (conserved or LOST — never gained). The single write door is
 * `advance_processing_stage`, the hardened RPC (migration 20260621110000): it
 * validates the target is a real `batch_stage`, forbids a BACKWARD move, and
 * forbids a mass GAIN, then updates `lots.stage` / `lots.current_kg` and appends
 * a `stage_advance` event. It is idempotent on `idempotency_key` — a replay is a
 * no-op returning the lot code, so a retry never double-advances or re-routes.
 *
 * This command is the symmetric twin of the read ports in `src/lib/db/*.ts`: a
 * pure validator (`validateAdvanceProcessingStage`, the friendly-error seam)
 * plus a thin command (`advanceProcessingStage`) that calls the single `.rpc()`
 * method it needs (the `AdvanceProcessingStageStore` port) so it is testable
 * against a fake store with no database — the SQL CHECK/raise inside the RPC is
 * the *real* enforcement; the validation here exists purely to surface friendly
 * errors before the round-trip. Mirrors the `@/lib/validation/*`
 * `ValidationResult` contract (the repo's friendly-error convention; zod is not
 * a project dependency).
 */

/** Validated, domain-shaped advance args (camelCase). */
export interface AdvanceProcessingStageInput {
  /** The `lots.code` whose stage is advanced (e.g. "JC-561"). */
  lotCode: string;
  /** The target pipeline stage — a real `batch_stage`. */
  toStage: BatchStage;
  /** Mass (kg) after this step — conserved or lost, never gained (RPC CHECK). */
  currentKg: number;
  /** Field wall-clock — `occurred_at`, carried onto the node update + event (D5). */
  occurredAt: string;
  /** Offline node identity — synthetic `"server"` for online writes today (D5). */
  deviceId: string;
  /** Per-device monotonic Lamport counter — `device_seq` (D4 replay safety). */
  deviceSeq: number;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`, D4). */
  idempotencyKey: string;
}

/** Is `v` a recognised, ISO-8601 timestamp (e.g. "2026-06-20T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/** Is `v` one of the recognised pipeline stages? (mirrors the `batch_stage` enum) */
function isBatchStage(v: string): v is BatchStage {
  return (BATCH_STAGES as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw advance (form record or object) — mirrors the
 * `advance_processing_stage` DB constraints so errors surface before the
 * round-trip. The SQL CHECK/raise (valid stage, forward-only, no mass gain) is
 * the actual enforcement (ADR-002).
 */
export function validateAdvanceProcessingStage(
  raw: Record<string, unknown>,
): ValidationResult<AdvanceProcessingStageInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!lotCode) errors.lotCode = "Choose a lot to advance.";

  const toStage = trimmed(raw.toStage);
  if (!toStage) {
    errors.toStage = "Choose a target stage.";
  } else if (!isBatchStage(toStage)) {
    errors.toStage = "Choose a valid pipeline stage.";
  }

  const currentKg = toNumber(raw.currentKg);
  if (currentKg === null || currentKg <= 0) {
    errors.currentKg = "Current weight (kg) must be greater than 0.";
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid advance time is required.";
  }

  const deviceId = trimmed(raw.deviceId);
  if (!deviceId) errors.deviceId = "A device id is required.";

  const deviceSeq = toNumber(raw.deviceSeq);
  if (deviceSeq === null || deviceSeq < 0 || !Number.isInteger(deviceSeq)) {
    errors.deviceSeq = "A device sequence is required.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) {
    errors.idempotencyKey = "An idempotency key is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      lotCode,
      toStage: toStage as BatchStage,
      currentKg: currentKg as number,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()`. */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `advance_processing_stage` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface AdvanceProcessingStageStore {
  rpc(
    fn: "advance_processing_stage",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

/** Outcome of the command: the advanced lot code, or friendly/labelled errors. */
export type AdvanceProcessingStageResult =
  | { ok: true; lotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Does this RPC error look like one of the hardened CHECK violations? The
 * backward-move and mass-gain guards raise with errcode `check_violation`
 * (SQLSTATE 23514); the bad-stage guard raises an invalid-enum error. We match
 * the message so the family sees a clean, human-readable reason rather than the
 * raw exception text.
 */
function friendlyRpcError(
  error: { message: string; code?: string },
  toStage: string,
): string | null {
  if (/backward/i.test(error.message)) {
    return `That moves the lot backward through the pipeline — a lot can only advance forward. (${error.message})`;
  }
  if (/current_kg cannot increase|cannot increase/i.test(error.message)) {
    return `Mass can't increase through processing — enter the weight after this step (it should be the same or lower). (${error.message})`;
  }
  if (/invalid input value for enum|batch_stage/i.test(error.message)) {
    return `"${toStage}" isn't a valid pipeline stage. (${error.message})`;
  }
  return null;
}

/**
 * Validate then advance: calls `advance_processing_stage` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); the hardened RPC's CHECK violations
 * (backward move / mass gain / bad stage) surface as CLEAN, family-readable
 * messages, any other failure surfaces labelled. The RPC is exactly-once on
 * `idempotencyKey` — a replay returns the lot code with no second advance.
 */
export async function advanceProcessingStage(
  store: AdvanceProcessingStageStore,
  raw: Record<string, unknown>,
): Promise<AdvanceProcessingStageResult> {
  const parsed = validateAdvanceProcessingStage(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("advance_processing_stage", {
    p_lot_code: parsed.data.lotCode,
    p_to_stage: parsed.data.toStage,
    p_current_kg: parsed.data.currentKg,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const friendly = friendlyRpcError(error, parsed.data.toStage);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `advance_processing_stage: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      message: "advance_processing_stage: no lot code returned",
    };
  }
  return { ok: true, lotCode: data };
}
