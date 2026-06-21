import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for crew attendance (ADR-002 — all writes flow through a
 * `SECURITY DEFINER` command RPC, one per business intent).
 *
 * Symmetric twin of the read ports: a pure validator (`validateAttendance`, the
 * friendly-error seam) plus a thin command (`recordAttendance`) that calls the
 * *single write door*, `record_attendance`. The command takes only the one
 * `.rpc()` method it needs (the `AttendanceStore` port) so it is testable
 * against a fake store with no database — the SQL CHECK/raise inside the RPC is
 * the *real* enforcement; the validation here exists purely to surface friendly
 * errors before the round-trip.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** The recognised attendance event kinds — mirrors the SQL CHECK. */
const EVENT_KINDS = ["clock-in", "clock-out", "rest-day", "absent"] as const;
type AttendanceEventKind = (typeof EVENT_KINDS)[number];

/** Validated, domain-shaped attendance args (camelCase). */
export interface AttendanceInput {
  workerId: string;
  eventKind: AttendanceEventKind;
  /** Optional plot the event happened on — nullable (`plot_id`). */
  plotId: string | null;
  /** Field wall-clock — `occurred_at`, the key every metric computes on. */
  occurredAt: string;
  /** Offline node identity — synthetic `"server"` for online writes today. */
  deviceId: string;
  /** Per-device monotonic Lamport counter — `device_seq` (replay safety). */
  deviceSeq: number;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/** Is `v` a recognised, ISO-8601 timestamp (e.g. "2026-06-20T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw attendance record — mirrors the `record_attendance`
 * DB constraints so errors surface before the round-trip. The SQL CHECK/raise is
 * the actual enforcement (ADR-002).
 */
export function validateAttendance(
  raw: Record<string, unknown>,
): ValidationResult<AttendanceInput> {
  const errors: Record<string, string> = {};

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a worker.";

  const eventKind = trimmed(raw.eventKind) as AttendanceEventKind;
  if (!EVENT_KINDS.includes(eventKind)) {
    errors.eventKind = "Choose an attendance event kind.";
  }

  // plotId is optional — only present when the event is tied to a plot.
  const plotIdRaw = trimmed(raw.plotId);
  const plotId = plotIdRaw === "" ? null : plotIdRaw;

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid event time is required.";
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
      eventKind,
      plotId,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (uuid → string). */
interface RpcResult {
  data: string | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `record_attendance` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface AttendanceStore {
  rpc(fn: "record_attendance", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the event uid, or friendly/labelled errors. */
export type AttendanceResult =
  | { ok: true; eventUid: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then record: calls `record_attendance` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the originally recorded
 * event uid, no second event.
 */
export async function recordAttendance(
  store: AttendanceStore,
  raw: Record<string, unknown>,
): Promise<AttendanceResult> {
  const parsed = validateAttendance(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_attendance", {
    p_worker_id: parsed.data.workerId,
    p_event_kind: parsed.data.eventKind,
    p_plot_id: parsed.data.plotId,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `record_attendance: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "record_attendance: no event id returned" };
  }
  return { ok: true, eventUid: data };
}
