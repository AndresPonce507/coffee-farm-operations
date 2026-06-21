import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for an eco-mill water draw (P2-S3; ADR-002 — all writes flow
 * through a `SECURITY DEFINER` command RPC). The symmetric twin of the read port
 * `@/lib/db/ferment.ts`: a pure validator (`validateMillWater`) plus a thin command
 * (`logMillWater`) that calls the single write door, `log_mill_water`, the append-only
 * water-per-kg ledger writer. The SQL CHECK (liters > 0) + FK (batch must exist) is the
 * real enforcement; the validation here surfaces friendly errors before the round-trip.
 */

export interface MillWaterInput {
  batchId: string;
  liters: number;
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

export function validateMillWater(
  raw: Record<string, unknown>,
): ValidationResult<MillWaterInput> {
  const errors: Record<string, string> = {};

  const batchId = trimmed(raw.batchId);
  if (!batchId) errors.batchId = "Choose a ferment batch.";

  const liters = toNumber(raw.liters);
  if (liters === null || liters <= 0) {
    errors.liters = "Liters must be greater than 0.";
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt)) {
    errors.occurredAt = "A valid time is required.";
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
      batchId,
      liters: liters as number,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

export interface LogMillWaterStore {
  rpc(fn: "log_mill_water", args: Record<string, unknown>): Promise<RpcResult>;
}

export type LogMillWaterResult =
  | { ok: true; logId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

function friendlyRpcError(error: { message: string; code?: string }): string | null {
  if (error.code === "23503" || /ferment batch|foreign key constraint/i.test(error.message)) {
    return "That ferment batch doesn't exist — start the batch before logging mill water.";
  }
  if (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message)
  ) {
    return "That water draw was already logged — refresh before logging again.";
  }
  return null;
}

/**
 * Validate then append: calls `log_mill_water` exactly once with the snake_case
 * envelope the SECURITY DEFINER RPC expects. Bad input never reaches the RPC; a known
 * PG error maps to a clean message; any other failure surfaces labelled. The RPC is
 * exactly-once on `idempotencyKey`.
 */
export async function logMillWater(
  store: LogMillWaterStore,
  raw: Record<string, unknown>,
): Promise<LogMillWaterResult> {
  const parsed = validateMillWater(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("log_mill_water", {
    p_batch_id: parsed.data.batchId,
    p_liters: parsed.data.liters,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const friendly = friendlyRpcError(error);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `log_mill_water: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "log_mill_water: no log id returned" };
  }
  return { ok: true, logId: data };
}
