import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the append-only environmental reading writer (P3-S20;
 * ADR-002). `storage_readings` is APPEND-ONLY (immutability triggers reject
 * UPDATE/DELETE): a correction is a superseding reading, never an edit. The single
 * write door is `record_storage_reading` — tenant-clamped, idempotent on a
 * tenant-qualified key (a re-synced offline / duplicated LoRaWAN uplink returns the
 * SAME row, never a double-count). `source` is feed-agnostic: 'manual' is the $0
 * path (a hygrometer / aw reading via the quick form); 'lorawan-sensor' is the
 * identical schema + a device id (a future ChirpStack gateway POSTs the same RPC).
 * A blank `reading_at` passes null so the RPC stamps `now()`.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordStorageReading`,
 * the friendly-error seam, mirroring the aw ∈ [0,1] CHECK + the source enum) plus a
 * thin command (`recordStorageReading`) that calls the one `.rpc()` it needs. The
 * idempotency key is REQUIRED — the action/form layer mints a stable token.
 */

/** The `storage_reading_source` enum — 'manual' is the $0 path. */
export const STORAGE_READING_SOURCES = ["manual", "lorawan-sensor"] as const;
export type StorageReadingSource = (typeof STORAGE_READING_SOURCES)[number];

/** Validated, domain-shaped reading args (camelCase). Blank measurements are null. */
export interface RecordStorageReadingInput {
  locationCode: string;
  tempC: number | null;
  rhPct: number | null;
  aw: number | null;
  source: StorageReadingSource;
  deviceId: string | null;
  /** Field wall-clock of the reading; null ⇒ the RPC stamps now(). */
  readingAt: string | null;
  idempotencyKey: string;
}

/** Is `v` one of the recognised reading sources? (mirrors the enum) */
function isStorageReadingSource(v: string): v is StorageReadingSource {
  return (STORAGE_READING_SOURCES as readonly string[]).includes(v);
}

/** Is `v` a recognised ISO-8601 timestamp (e.g. "2026-06-21T09:00:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/** Read a measurement field: blank ⇒ null (a partial reading is legal). */
function optionalMeasurement(
  raw: unknown,
  key: string,
  errors: Record<string, string>,
  label: string,
): number | null {
  if (trimmed(raw) === "") return null;
  const v = toNumber(raw);
  if (v === null) {
    errors[key] = `${label} must be a number.`;
    return null;
  }
  return v;
}

/**
 * Pure validation of a raw reading — mirrors the `storage_readings` constraints
 * (the aw ∈ [0,1] CHECK, the source enum) so errors surface before the round-trip.
 * The append-only triggers + tenant clamp + idempotency are the real enforcement.
 * A partial reading (e.g. an aw-only check) is legal — only provided values are
 * validated; blanks pass as null.
 */
export function validateRecordStorageReading(
  raw: Record<string, unknown>,
): ValidationResult<RecordStorageReadingInput> {
  const errors: Record<string, string> = {};

  const locationCode = trimmed(raw.locationCode);
  if (!locationCode) errors.locationCode = "Choose a storage location.";

  const tempC = optionalMeasurement(raw.tempC, "tempC", errors, "Temperature");
  const rhPct = optionalMeasurement(raw.rhPct, "rhPct", errors, "Humidity");
  const aw = optionalMeasurement(raw.aw, "aw", errors, "Water activity");
  if (aw !== null && (aw < 0 || aw > 1)) {
    errors.aw = "Water activity must be between 0 and 1.";
  }

  // Blank source defaults to 'manual'; a supplied value must be a known feed.
  const rawSource = trimmed(raw.source) || "manual";
  if (!isStorageReadingSource(rawSource)) {
    errors.source = "Choose a valid reading source.";
  }

  const deviceId = trimmed(raw.deviceId) || null;

  // Blank reading time means "not provided" → null (the RPC stamps now()).
  const rawReadingAt = trimmed(raw.readingAt);
  let readingAt: string | null = null;
  if (rawReadingAt) {
    if (!isISOTimestamp(rawReadingAt)) {
      errors.readingAt = "A valid reading time is required.";
    } else {
      readingAt = rawReadingAt;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      locationCode,
      tempC,
      rhPct,
      aw,
      source: rawSource as StorageReadingSource,
      deviceId,
      readingAt,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `record_storage_reading` needs. */
export interface RecordStorageReadingStore {
  rpc(
    fn: "record_storage_reading",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the reading's id, or friendly/labelled errors. */
export type RecordStorageReadingResult =
  | { ok: true; readingId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_storage_reading` onto a family-readable
 * sentence (the unknown-location rejection). Returns null for anything
 * unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyRecordStorageReadingError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown storage location|foreign key/.test(m)) {
    return "That storage location couldn't be found. Pick a location and try again.";
  }
  return null;
}

/**
 * Validate then record: calls `record_storage_reading` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * the unknown-location rejection surfaces as a CLEAN sentence, any other failure
 * labelled. Exactly-once on `idempotencyKey` — a replay returns the same reading id.
 */
export async function recordStorageReading(
  store: RecordStorageReadingStore,
  raw: Record<string, unknown>,
): Promise<RecordStorageReadingResult> {
  const parsed = validateRecordStorageReading(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_storage_reading", {
    p_location_code: parsed.data.locationCode,
    p_temp_c: parsed.data.tempC,
    p_rh_pct: parsed.data.rhPct,
    p_aw: parsed.data.aw,
    p_source: parsed.data.source,
    p_device_id: parsed.data.deviceId,
    p_reading_at: parsed.data.readingAt,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordStorageReadingError(error) ??
        `Couldn't record the reading: ${error.message}`,
    };
  }
  if (data == null) {
    return { ok: false, message: "The reading couldn't be recorded. Please try again." };
  }
  return { ok: true, readingId: Number(data) };
}
