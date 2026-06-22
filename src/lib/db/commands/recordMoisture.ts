import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for recording a moisture reading on a lot's drying curve
 * (P2-S4 — drying management + the reposo gate; ADR-002 — all writes flow through
 * a `SECURITY DEFINER` command RPC, one per business intent).
 *
 * The reading is the EVIDENCE the reposo gate reads: a lot cannot advance
 * drying→milled until its most-recent readings sit stable inside the moisture band
 * (and the rest-days threshold is met). The single write door is
 * `record_moisture_reading` — an append-only, idempotent RPC (a replay on the same
 * `idempotency_key` is a no-op returning the reading id). This command is a pure
 * validator (the friendly-error seam) plus a thin call to the one `.rpc()` method
 * it needs (the `RecordMoistureStore` port) so it is testable against a fake store
 * with no database — the SQL constraints are the real enforcement. Mirrors the
 * `advanceProcessingStage` / `recordCherryIntake` command idiom.
 */

/** Validated, domain-shaped moisture-reading args (camelCase). */
export interface RecordMoistureInput {
  lotCode: string;
  /** Moisture % — 0..100, the value plotted on the drying curve. */
  moisturePct: number;
  /** Field wall-clock — `occurred_at` (the reading's true time). */
  occurredAt: string;
  /** Offline node identity — `device_id` (D5). */
  deviceId: string;
  /** Per-device monotonic Lamport counter — `device_seq` (D4 replay safety). */
  deviceSeq: number;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`, D4). */
  idempotencyKey: string;
}

function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw moisture reading — mirrors the
 * `record_moisture_reading` DB constraints (0 ≤ pct ≤ 100, real lot, real time)
 * so errors surface before the round-trip. The SQL CHECK/raise is the actual
 * enforcement (ADR-002).
 */
export function validateRecordMoisture(
  raw: Record<string, unknown>,
): ValidationResult<RecordMoistureInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!lotCode) errors.lotCode = "Choose a lot to record a reading for.";

  const moisturePct = toNumber(raw.moisturePct);
  if (moisturePct === null || moisturePct < 0 || moisturePct > 100) {
    errors.moisturePct = "Moisture must be a percentage between 0 and 100.";
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid reading time is required.";
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
      moisturePct: moisturePct as number,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (a bigint reading id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method this command needs. */
export interface RecordMoistureStore {
  rpc(
    fn: "record_moisture_reading",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export type RecordMoistureResult =
  | { ok: true; readingId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Translate the RPC's known failures into clean, family-readable reasons. */
function friendlyRpcError(
  error: { message: string; code?: string },
  lotCode: string,
): string | null {
  if (error.code === "23503" || /foreign key constraint/i.test(error.message)) {
    return `Lot ${lotCode} doesn't exist — choose a lot that's in the mill.`;
  }
  // `moisture_readings` carries BOTH unique(idempotency_key) AND
  // unique(device_id, device_seq). The RPC short-circuits a genuine replay on
  // `idempotency_key` BEFORE the INSERT, so the only path to a 23505 reaching here
  // is a NON-replay collision on `(device_id, device_seq)` — a distinct reading
  // that was rejected and LOST (e.g. two devices sharing a `device_id`, or a
  // reused/forked sequence counter). Disambiguate by constraint NAME, not bare
  // SQLSTATE, so a dropped reading surfaces as a real error instead of the
  // benign "already recorded" message. (#131)
  if (/device_id_device_seq/i.test(error.message)) {
    return "This reading clashed with another from the same device — its sequence number was reused. Re-sync the device and try again.";
  }
  if (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message)
  ) {
    return "That reading was already recorded — refresh to see it.";
  }
  if (/moisture_pct|check constraint/i.test(error.message)) {
    return "Moisture must be a percentage between 0 and 100.";
  }
  return null;
}

/**
 * Validate then record: calls `record_moisture_reading` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the existing reading id with
 * no second row.
 */
export async function recordMoisture(
  store: RecordMoistureStore,
  raw: Record<string, unknown>,
): Promise<RecordMoistureResult> {
  const parsed = validateRecordMoisture(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_moisture_reading", {
    p_lot_code: parsed.data.lotCode,
    p_moisture_pct: parsed.data.moisturePct,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const friendly = friendlyRpcError(error, parsed.data.lotCode);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `record_moisture_reading: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "record_moisture_reading: no reading id returned" };
  }
  return { ok: true, readingId: Number(data) };
}
