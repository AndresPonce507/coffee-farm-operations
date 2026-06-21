import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for the INBOUND dispatch acknowledgement (P2-S5, ADR-002 —
 * all writes flow through a `SECURITY DEFINER` command RPC, one per business
 * intent).
 *
 * 🚨 THE INJECTION-SAFE INBOUND WRITER. This is the ONLY thing an inbound crew-lead
 * "got it" reply may do: append ONE `dispatch_acknowledgement` EVIDENCE row. It
 * records EVIDENCE ONLY and can NEVER drive a domain action — it does not advance
 * the run, fire a task, mutate an assignment, or reach any other command verb. The
 * untrusted inbound `workerId` is forwarded verbatim (or null for an unknown
 * sender) and is NEVER interpreted into an action. Keep this a thin ack recorder:
 * do NOT add any logic that parses inbound text. The manager acts; untrusted text
 * is never a puppeteer. (Carries the global no-untrusted-text-drives-action rule.)
 *
 * A pure validator (`validateRecordDispatchAck`, the friendly-error seam) plus a
 * thin command (`recordDispatchAck`) that calls the *single write door*,
 * `record_dispatch_ack`. The command takes only the one `.rpc()` method it needs
 * (the `RecordDispatchAckStore` port) so it is testable against a fake store with
 * no database — the SQL CHECK/raise inside the RPC is the *real* enforcement.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** Validated, domain-shaped ack args (camelCase). */
export interface RecordDispatchAckInput {
  /** The dispatch run being acknowledged — a bigint id (`run_id`). */
  runId: number;
  /** The crew lead who acked — OPTIONAL/nullable: an unknown sender is allowed. */
  workerId: string | null;
  /** Free-text inbound source label (e.g. 'whatsapp-inbound') — NOT an enum. */
  channel: string;
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
 * Pure validation of a raw ack record — mirrors the `record_dispatch_ack` DB
 * constraints so errors surface before the round-trip. The SQL CHECK/raise is the
 * actual enforcement (ADR-002). A blank/absent `workerId` is NOT an error — it is
 * a recognised "unknown sender" and normalises to null.
 */
export function validateRecordDispatchAck(
  raw: Record<string, unknown>,
): ValidationResult<RecordDispatchAckInput> {
  const errors: Record<string, string> = {};

  // run_id is a bigint identity — a positive integer.
  const runId = toNumber(raw.runId);
  if (runId === null || runId <= 0 || !Number.isInteger(runId)) {
    errors.runId = "A dispatch run is required.";
  }

  // workerId is optional — an unknown sender is allowed (normalises to null).
  const workerIdRaw = trimmed(raw.workerId);
  const workerId = workerIdRaw === "" ? null : workerIdRaw;

  // channel is a free-text inbound source label, not an enum — just non-empty.
  const channel = trimmed(raw.channel);
  if (!channel) errors.channel = "An inbound channel is required.";

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
      runId: runId as number,
      workerId,
      channel,
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

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `record_dispatch_ack` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 *
 * 🚨 By construction the inbound path reaches ONLY this one append-only evidence
 * writer — never `generate_dispatch` / `mark_dispatch_sent` / any other verb.
 */
export interface RecordDispatchAckStore {
  rpc(fn: "record_dispatch_ack", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the new ack id, or friendly/labelled errors. */
export type RecordDispatchAckResult =
  | { ok: true; ackId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then record-ack: calls `record_dispatch_ack` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replayed inbound is one evidence row.
 *
 * 🚨 EVIDENCE ONLY: this records THAT the crew lead saw the dispatch. It cannot,
 * by construction, drive any action — the run's status only ever becomes
 * `acknowledged` through a separate, deliberate OWNER action, never from here.
 */
export async function recordDispatchAck(
  store: RecordDispatchAckStore,
  raw: Record<string, unknown>,
): Promise<RecordDispatchAckResult> {
  const parsed = validateRecordDispatchAck(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_dispatch_ack", {
    p_run_id: parsed.data.runId,
    p_worker_id: parsed.data.workerId,
    p_channel: parsed.data.channel,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `record_dispatch_ack: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "record_dispatch_ack: no ack id returned" };
  }
  return { ok: true, ackId: data };
}
