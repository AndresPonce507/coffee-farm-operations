import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for the per-picker weigh-in (P2-S2 — THE GENESIS FIELD EVENT,
 * ADR-002: all writes flow through a single SECURITY DEFINER command RPC).
 *
 * Symmetric twin of the read ports: a pure validator (`validateWeighIn`, the
 * friendly-error seam) plus a thin command (`recordWeighIn`) that calls the single
 * write door, `record_weigh_in`. The command takes only the one `.rpc()` method it
 * needs (the `WeighStore` port) so it is testable against a fake store with no
 * database — the SQL CHECK/raise inside the RPC is the *real* enforcement; the
 * validation here exists purely to surface friendly errors before the round-trip.
 *
 * The RPC is exactly-once on `idempotencyKey` and offline-replayable: it accepts the
 * S0 client-minted `device_id`/`device_seq`/`idempotency_key`, so a queued replay or
 * a double-tap dedupes to one weigh_event server-side.
 */

/** The ripeness taps the field UI offers — mirrors the SQL `ripeness` enum. */
export const RIPENESS_VALUES = ["underripe", "ripe", "overripe"] as const;
export type Ripeness = (typeof RIPENESS_VALUES)[number];

/** The scale sources — a BLE scale read or a manual numeric-pad entry. */
export const SCALE_SOURCES = ["ble", "manual"] as const;
export type ScaleSource = (typeof SCALE_SOURCES)[number];

/** Validated, domain-shaped weigh-in args (camelCase). */
export interface WeighInInput {
  workerId: string;
  plotId: string;
  /** Cherry mass in kg — the conserved quantity (>= 0). */
  cherriesKg: number;
  ripeness: Ripeness;
  /** Optional Brix reading (BLE/manual probe later) — null when absent. */
  brix: number | null;
  scaleSource: ScaleSource;
  /** The geofence GPS fix — null when signal-dead (geofence becomes a NULL signal). */
  capturedLat: number | null;
  capturedLng: number | null;
  /** Field wall-clock — `occurred_at`. */
  occurredAt: string;
  /** Offline node identity — synthetic `"server"` for online writes today. */
  deviceId: string;
  /** Per-device monotonic counter — `device_seq` (replay safety). */
  deviceSeq: number;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/** Is `v` a recognised ISO-8601 timestamp (e.g. "2026-06-21T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/** Coerce a value to a finite number, or null (used for optional lat/lng/brix). */
function optionalNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  return toNumber(v);
}

/**
 * Pure validation of a raw weigh-in record — mirrors the `record_weigh_in` DB
 * constraints so errors surface before the round-trip. The SQL CHECK/raise is the
 * actual enforcement (the worker-is-an-active-crew-member gate lives only in the RPC).
 */
export function validateWeighIn(
  raw: Record<string, unknown>,
): ValidationResult<WeighInInput> {
  const errors: Record<string, string> = {};

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Badge the picker.";

  const plotId = trimmed(raw.plotId);
  if (!plotId) errors.plotId = "Confirm the plot.";

  const cherriesKg = toNumber(raw.cherriesKg);
  if (cherriesKg === null || cherriesKg < 0) {
    errors.cherriesKg = "Enter the weight in kg.";
  }

  const ripeness = trimmed(raw.ripeness) as Ripeness;
  if (!RIPENESS_VALUES.includes(ripeness)) {
    errors.ripeness = "Tap a ripeness.";
  }

  // brix is optional — only present with a probe reading.
  const brix = optionalNumber(raw.brix);

  // scaleSource defaults to manual (the always-available fallback) when absent/blank.
  const sourceRaw = trimmed(raw.scaleSource) as ScaleSource;
  const scaleSource: ScaleSource = SCALE_SOURCES.includes(sourceRaw)
    ? sourceRaw
    : "manual";

  // lat/lng optional — a missing fix is fine (geofence becomes a NULL signal).
  const capturedLat = optionalNumber(raw.capturedLat);
  const capturedLng = optionalNumber(raw.capturedLng);

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt)) {
    errors.occurredAt = "A valid capture time is required.";
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
      workerId,
      plotId,
      cherriesKg: cherriesKg as number,
      ripeness,
      brix,
      scaleSource,
      capturedLat,
      capturedLng,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (lot_code text → string). */
interface RpcResult {
  data: string | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_weigh_in` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface WeighStore {
  rpc(
    fn: "record_weigh_in",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

/** Outcome of the command: the bound lot code, or friendly/labelled errors. */
export type WeighInResult =
  | { ok: true; lotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Build the snake_case argument envelope the SECURITY DEFINER RPC expects from a
 * validated weigh-in. Exported so the offline transport (S0) can build the exact
 * same envelope it queues, without re-validating.
 */
export function weighInRpcArgs(input: WeighInInput): Record<string, unknown> {
  return {
    p_worker_id: input.workerId,
    p_plot_id: input.plotId,
    p_cherries_kg: input.cherriesKg,
    p_ripeness: input.ripeness,
    p_brix: input.brix,
    p_scale_source: input.scaleSource,
    p_captured_lat: input.capturedLat,
    p_captured_lng: input.capturedLng,
    p_occurred_at: input.occurredAt,
    p_device_id: input.deviceId,
    p_device_seq: input.deviceSeq,
    p_idempotency_key: input.idempotencyKey,
  };
}

/**
 * Validate then record: calls `record_weigh_in` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC (friendly errors); RPC failures surface
 * labelled. The RPC is exactly-once on `idempotencyKey` — a replay returns the
 * originally bound lot code, writing no second weigh_event.
 */
export async function recordWeighIn(
  store: WeighStore,
  raw: Record<string, unknown>,
): Promise<WeighInResult> {
  const parsed = validateWeighIn(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc(
    "record_weigh_in",
    weighInRpcArgs(parsed.data),
  );

  if (error) {
    return { ok: false, message: `record_weigh_in: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "record_weigh_in: no lot code returned" };
  }
  return { ok: true, lotCode: data };
}
