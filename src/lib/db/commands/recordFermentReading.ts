import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";
import type { FermentReadingKind } from "@/lib/db/ferment";

/**
 * Write-side command for a fermentation reading (P2-S3 make-quality trunk; ADR-002 —
 * all writes flow through a `SECURITY DEFINER` command RPC, one per business intent).
 *
 * The symmetric twin of the read port `@/lib/db/ferment.ts`: a pure validator
 * (`validateFermentReading`, the friendly-error seam) plus a thin command
 * (`recordFermentReading`) that calls the single write door, `record_ferment_reading`,
 * the append-only readings ledger writer. The command takes only the one `.rpc()`
 * method it needs (the `RecordFermentReadingStore` port) so it is testable against a
 * fake store with no database — the SQL CHECK/FK/append-only triggers inside the RPC
 * are the *real* enforcement; the validation here surfaces friendly errors before the
 * round-trip. Mirrors the `@/lib/validation/*` `ValidationResult` contract (zod is not
 * a project dependency).
 */

const KINDS: readonly FermentReadingKind[] = ["ph", "temp", "brix"];

export interface FermentReadingInput {
  batchId: string;
  kind: FermentReadingKind;
  value: number;
  /** Field wall-clock — `occurred_at`, the x-axis of the live curve (D5). */
  occurredAt: string;
  /** Offline node identity — synthetic for online writes today (D5). */
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

function isKind(v: string): v is FermentReadingKind {
  return (KINDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw reading — mirrors the `record_ferment_reading` DB
 * constraints so errors surface before the round-trip. The SQL CHECK/FK/append-only
 * is the actual enforcement (ADR-002).
 */
export function validateFermentReading(
  raw: Record<string, unknown>,
): ValidationResult<FermentReadingInput> {
  const errors: Record<string, string> = {};

  const batchId = trimmed(raw.batchId);
  if (!batchId) errors.batchId = "Choose a ferment batch.";

  const kindRaw = trimmed(raw.kind);
  if (!isKind(kindRaw)) {
    errors.kind = "Choose a reading kind (pH, temp or Brix).";
  }

  const value = toNumber(raw.value);
  if (value === null) {
    errors.value = "Enter a numeric reading.";
  } else if (isKind(kindRaw)) {
    // Kind-scoped sanity bounds mirroring the DB CHECK `ferment_readings_value_range`
    // (the REAL enforcement, ADR-002): a sensor-fault temp (probe error 9999) or a
    // probe-in-air Brix (−5) would otherwise land in the APPEND-ONLY ledger forever,
    // skewing the curve with no way to correct it. The friendly seam catches these
    // before the round-trip. Ranges match the DB to the unit so the validator never
    // rejects a value the ledger accepts (and vice versa).
    if (kindRaw === "ph" && (value < 0 || value > 14)) {
      // pH lives on the 0–14 scale; a value outside it is a typo, not a reading.
      errors.value = "pH must be between 0 and 14.";
    } else if (kindRaw === "temp" && (value < -5 || value > 60)) {
      // A wet-ferment tank runs ~−5 °C (cold highland nights) to 60 °C; outside that
      // is a mis-key or a BLE-probe fault, not a real tank temperature.
      errors.value = "Temperature must be between −5 and 60 °C.";
    } else if (kindRaw === "brix" && (value < 0 || value > 40)) {
      // Coffee-mucilage Brix sits ~0–40 °Bx; a negative or huge value means the
      // refractometer was dry/in-air, not reading sugar.
      errors.value = "Brix must be between 0 and 40 °Bx.";
    }
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt)) {
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
      batchId,
      kind: kindRaw as FermentReadingKind,
      value: value as number,
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

/** The narrow write port the command depends on — exactly the one `.rpc()` method
 *  `record_ferment_reading` needs. A Supabase client satisfies this structurally. */
export interface RecordFermentReadingStore {
  rpc(
    fn: "record_ferment_reading",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export type RecordFermentReadingResult =
  | { ok: true; readingId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Map a raw Postgres/PostgREST error onto a clean, family-readable message so raw
 *  constraint text never leaks. */
function friendlyRpcError(error: { message: string; code?: string }): string | null {
  if (error.code === "23503" || /ferment batch|foreign key constraint/i.test(error.message)) {
    return "That ferment batch doesn't exist — start the batch before logging readings.";
  }
  if (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message)
  ) {
    return "That reading was already recorded — refresh the curve before logging again.";
  }
  // The DB CHECK `ferment_readings_value_range` fails closed on an out-of-range
  // pH/temp/Brix even if a value slips past the validator (future caller, UI bug).
  // Surface a clean prompt, never the raw constraint text.
  if (error.code === "23514" || /ferment_readings_value_range|check constraint/i.test(error.message)) {
    return "That reading is out of range — check the probe and re-log.";
  }
  return null;
}

/**
 * Validate then append: calls `record_ferment_reading` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC; a known PG error maps to a clean message; any other failure
 * surfaces labelled. The RPC is exactly-once on `idempotencyKey` — a replay (e.g.
 * from the offline outbox) is one row.
 */
export async function recordFermentReading(
  store: RecordFermentReadingStore,
  raw: Record<string, unknown>,
): Promise<RecordFermentReadingResult> {
  const parsed = validateFermentReading(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_ferment_reading", {
    p_batch_id: parsed.data.batchId,
    p_kind: parsed.data.kind,
    p_value: parsed.data.value,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const friendly = friendlyRpcError(error);
    if (friendly) return { ok: false, message: friendly };
    return { ok: false, message: `record_ferment_reading: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "record_ferment_reading: no reading id returned" };
  }
  return { ok: true, readingId: data };
}
