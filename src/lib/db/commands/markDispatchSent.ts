import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for the OWNER-INITIATED OUTBOUND "share the card" transition
 * (P2-S5, ADR-002 — all writes flow through a `SECURITY DEFINER` command RPC, one
 * per business intent).
 *
 * A pure validator (`validateMarkDispatchSent`, the friendly-error seam) plus a
 * thin command (`markDispatchSent`) that calls the *single write door*,
 * `mark_dispatch_sent`. The command takes only the one `.rpc()` method it needs
 * (the `MarkDispatchSentStore` port) so it is testable against a fake store with
 * no database — the SQL CHECK/raise inside the RPC is the *real* enforcement.
 *
 * This is the deliberate manager action that moves a draft run to `sent`, stamps
 * the channel, and enqueues a `dispatch_outbound` row for the app-layer delivery
 * adapter (the $0 web-share sheet by default; whatsapp-cloud is a dormant drop-in).
 * Generation never reaches it.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** The recognised outbound delivery channels — mirrors the SQL CHECK. */
const CHANNELS = ["web-share", "copy-link", "whatsapp-cloud", "sms"] as const;
type DispatchChannel = (typeof CHANNELS)[number];

/** Validated, domain-shaped mark-sent args (camelCase). */
export interface MarkDispatchSentInput {
  /** The dispatch run being sent — a bigint id (`run_id`). */
  runId: number;
  channel: DispatchChannel;
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
 * Pure validation of a raw mark-sent record — mirrors the `mark_dispatch_sent`
 * DB constraints so errors surface before the round-trip. The SQL CHECK/raise is
 * the actual enforcement (ADR-002).
 */
export function validateMarkDispatchSent(
  raw: Record<string, unknown>,
): ValidationResult<MarkDispatchSentInput> {
  const errors: Record<string, string> = {};

  // run_id is a bigint identity — a positive integer.
  const runId = toNumber(raw.runId);
  if (runId === null || runId <= 0 || !Number.isInteger(runId)) {
    errors.runId = "A dispatch run is required.";
  }

  const channel = trimmed(raw.channel) as DispatchChannel;
  if (!CHANNELS.includes(channel)) {
    errors.channel = "Choose a delivery channel.";
  }

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
 * method `mark_dispatch_sent` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface MarkDispatchSentStore {
  rpc(fn: "mark_dispatch_sent", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the run id, or friendly/labelled errors. */
export type MarkDispatchSentResult =
  | { ok: true; runId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then mark-sent: calls `mark_dispatch_sent` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay does not double-send.
 */
export async function markDispatchSent(
  store: MarkDispatchSentStore,
  raw: Record<string, unknown>,
): Promise<MarkDispatchSentResult> {
  const parsed = validateMarkDispatchSent(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("mark_dispatch_sent", {
    p_run_id: parsed.data.runId,
    p_channel: parsed.data.channel,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `mark_dispatch_sent: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "mark_dispatch_sent: no run id returned" };
  }
  return { ok: true, runId: data };
}
