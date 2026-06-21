import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for enrolling a worker into a crew (ADR-002 — all writes
 * flow through a `SECURITY DEFINER` command RPC, one per business intent).
 *
 * A pure validator (`validateCrewEnrollment`, the friendly-error seam) plus a
 * thin command (`enrollCrewMember`) that calls the *single write door*,
 * `enroll_crew_member`. The command takes only the one `.rpc()` method it needs
 * (the `CrewEnrollmentStore` port) so it is testable against a fake store with
 * no database — the SQL CHECK/raise inside the RPC is the *real* enforcement.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** Validated, domain-shaped enrollment args (camelCase). */
export interface CrewEnrollmentInput {
  workerId: string;
  crewId: string;
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
 * Pure validation of a raw enrollment record — mirrors the `enroll_crew_member`
 * DB constraints so errors surface before the round-trip. The SQL CHECK/raise is
 * the actual enforcement (ADR-002).
 */
export function validateCrewEnrollment(
  raw: Record<string, unknown>,
): ValidationResult<CrewEnrollmentInput> {
  const errors: Record<string, string> = {};

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a worker.";

  const crewId = trimmed(raw.crewId);
  if (!crewId) errors.crewId = "Choose a crew.";

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
      crewId,
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
 * method `enroll_crew_member` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface CrewEnrollmentStore {
  rpc(fn: "enroll_crew_member", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the event uid, or friendly/labelled errors. */
export type CrewEnrollmentResult =
  | { ok: true; eventUid: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then enroll: calls `enroll_crew_member` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the originally recorded
 * event uid, no second enrollment.
 */
export async function enrollCrewMember(
  store: CrewEnrollmentStore,
  raw: Record<string, unknown>,
): Promise<CrewEnrollmentResult> {
  const parsed = validateCrewEnrollment(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("enroll_crew_member", {
    p_worker_id: parsed.data.workerId,
    p_crew_id: parsed.data.crewId,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `enroll_crew_member: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "enroll_crew_member: no event id returned" };
  }
  return { ok: true, eventUid: data };
}
