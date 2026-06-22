import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for an IPM scouting observation (P2-S12, ADR-002). The
 * economic-threshold evaluation + control-task firing happen inside the SQL
 * `record_scouting` RPC (the closed loop); this module is the thin, pure write
 * seam — a friendly validator + a command that calls the single write door.
 */

/** A valid ISO timestamp (date or date-time). */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  return Number.isFinite(Date.parse(v));
}

/** Validated, domain-shaped scouting args (camelCase). */
export interface ScoutingInput {
  plotId: string;
  pestKind: string;
  /** Observed incidence in [0,100]. */
  incidencePct: number;
  notes: string | null;
  workerId: string | null;
  occurredAt: string;
  /** Offline node identity — `device_id` (D5, the offline-replay key half). */
  deviceId: string;
  /** Per-device monotonic Lamport counter — `device_seq` (D4 replay safety). */
  deviceSeq: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw scouting observation — mirrors the `record_scouting`
 * DB constraints (incidence in [0,100]) so errors surface before the round-trip.
 * The SQL is the actual enforcement.
 */
export function validateScouting(
  raw: Record<string, unknown>,
): ValidationResult<ScoutingInput> {
  const errors: Record<string, string> = {};

  const plotId = trimmed(raw.plotId);
  if (!plotId) errors.plotId = "Choose a plot.";

  const pestKind = trimmed(raw.pestKind);
  if (!pestKind) errors.pestKind = "A pest is required.";

  const incidence = toNumber(raw.incidencePct);
  if (incidence === null || incidence < 0 || incidence > 100) {
    errors.incidencePct = "Incidence must be between 0 and 100%.";
  }

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt)) {
    errors.occurredAt = "A valid scouting time is required.";
  }

  const notesRaw = trimmed(raw.notes);
  const notes = notesRaw === "" ? null : notesRaw;

  const workerRaw = trimmed(raw.workerId);
  const workerId = workerRaw === "" ? null : workerRaw;

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
      plotId,
      pestKind,
      incidencePct: incidence as number,
      notes,
      workerId,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint → number). */
interface RpcResult {
  data: number | null;
  error: { message: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_scouting` needs. */
export interface ScoutingStore {
  rpc(fn: "record_scouting", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the observation id, or friendly/labelled errors. */
export type ScoutingResult =
  | { ok: true; observationId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then record: calls `record_scouting` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC. Exactly-once on `idempotencyKey`.
 */
export async function recordScouting(
  store: ScoutingStore,
  raw: Record<string, unknown>,
): Promise<ScoutingResult> {
  const parsed = validateScouting(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_scouting", {
    p_plot_id: parsed.data.plotId,
    p_pest_kind: parsed.data.pestKind,
    p_incidence_pct: parsed.data.incidencePct,
    p_notes: parsed.data.notes,
    p_worker_id: parsed.data.workerId,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: `record_scouting: ${error.message}` };
  if (data === null || data === undefined) {
    return { ok: false, message: "record_scouting: no observation id returned" };
  }
  return { ok: true, observationId: data };
}
