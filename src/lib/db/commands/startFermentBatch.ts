import type { ProcessMethod } from "@/lib/types";
import { PROCESS_METHODS } from "@/lib/enums";
import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for starting a fermentation batch (P2-S3; ADR-002 — all writes
 * flow through a `SECURITY DEFINER` command RPC). The symmetric twin of the read port
 * `@/lib/db/ferment.ts`: a pure validator (`validateStartFermentBatch`) plus a thin
 * command (`startFermentBatch`) that calls the single write door, `start_ferment_batch`,
 * which opens a batch bound to a lot_code + a recipe version and appends a
 * `ferment_started` lot_event in one txn, exactly-once on `idempotency_key`. The SQL
 * FK (lot must exist, recipe must exist) is the real enforcement; the validation here
 * surfaces friendly errors before the round-trip.
 */

export interface StartFermentBatchInput {
  lotCode: string;
  /** The recipe VERSION the batch runs against (required — the UI enforces a pick). */
  recipeId: string;
  method: ProcessMethod;
  occurredAt: string;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

function isMethod(v: string): v is ProcessMethod {
  return (PROCESS_METHODS as readonly string[]).includes(v);
}

export function validateStartFermentBatch(
  raw: Record<string, unknown>,
): ValidationResult<StartFermentBatchInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!lotCode) errors.lotCode = "Choose a lot to ferment.";

  // recipe is REQUIRED at start — the UI enforces a pick before opening a batch.
  const recipeId = trimmed(raw.recipeId);
  if (!recipeId) errors.recipeId = "Choose a recipe version to ferment against.";

  const methodRaw = trimmed(raw.method);
  if (!isMethod(methodRaw)) {
    errors.method = "Choose a processing method.";
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt)) {
    errors.occurredAt = "A valid start time is required.";
  }

  const deviceId = trimmed(raw.deviceId);
  if (!deviceId) errors.deviceId = "A device id is required.";

  const deviceSeq = toNumber(raw.deviceSeq);
  if (deviceSeq === null || deviceSeq < 0 || !Number.isInteger(deviceSeq)) {
    errors.deviceSeq = "A device sequence is required.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      lotCode,
      recipeId,
      method: methodRaw as ProcessMethod,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

export interface StartFermentBatchStore {
  rpc(
    fn: "start_ferment_batch",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export type StartFermentBatchResult =
  | { ok: true; batchId: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

function friendlyRpcError(error: { message: string; code?: string }): string | null {
  if (error.code === "23503" || /unknown lot|unknown recipe|foreign key constraint/i.test(error.message)) {
    return "That lot or recipe doesn't exist — choose a milled-in lot and a recipe version that's in the library.";
  }
  if (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message)
  ) {
    return "That batch was already started — refresh the ferment board.";
  }
  return null;
}

/**
 * Validate then start: calls `start_ferment_batch` exactly once with the snake_case
 * envelope the SECURITY DEFINER RPC expects. Bad input never reaches the RPC; a known
 * PG error maps to a clean message; any other failure surfaces labelled. The RPC is
 * exactly-once on `idempotencyKey`.
 */
export async function startFermentBatch(
  store: StartFermentBatchStore,
  raw: Record<string, unknown>,
): Promise<StartFermentBatchResult> {
  const parsed = validateStartFermentBatch(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("start_ferment_batch", {
    p_lot_code: parsed.data.lotCode,
    p_recipe_id: parsed.data.recipeId,
    p_method: parsed.data.method,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const friendly = friendlyRpcError(error);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `start_ferment_batch: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "start_ferment_batch: no batch id returned" };
  }
  return { ok: true, batchId: data };
}
