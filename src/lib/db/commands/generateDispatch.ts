import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for GENERATING a morning crew dispatch (P2-S5, ADR-002 —
 * all writes flow through a `SECURITY DEFINER` command RPC, one per business
 * intent).
 *
 * A pure validator (`validateGenerateDispatch`, the friendly-error seam) plus a
 * thin command (`generateDispatch`) that calls the *single write door*,
 * `generate_dispatch`. The command takes only the one `.rpc()` method it needs
 * (the `GenerateDispatchStore` port) so it is testable against a fake store with
 * no database — the SQL CHECK/raise inside the RPC is the *real* enforcement; the
 * validation here exists purely to surface friendly errors before the round-trip.
 *
 * generate_dispatch is OWNER-INITIATED and NEVER auto-sends: it creates a DRAFT
 * run + its ripeness-ordered assignments and stops. Sharing the card is a
 * separate, deliberate action (`mark_dispatch_sent`).
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** Validated, domain-shaped generate-dispatch args (camelCase). */
export interface GenerateDispatchInput {
  crewId: string;
  /** The day this dispatch is for — a calendar date (`dispatch_date`). */
  dispatchDate: string;
  season: string;
  /** Ripeness gate in [0,1]; a plot ≥ this is dispatched (`readiness_threshold`). */
  readinessThreshold: number;
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
 * Pure validation of a raw generate-dispatch record — mirrors the
 * `generate_dispatch` DB constraints so errors surface before the round-trip.
 * The SQL CHECK/raise is the actual enforcement (ADR-002).
 */
export function validateGenerateDispatch(
  raw: Record<string, unknown>,
): ValidationResult<GenerateDispatchInput> {
  const errors: Record<string, string> = {};

  const crewId = trimmed(raw.crewId);
  if (!crewId) errors.crewId = "Choose a crew.";

  // dispatch_date is a calendar date (DATE column), NOT a timestamp.
  const dispatchDate = trimmed(raw.dispatchDate);
  if (!isISODate(dispatchDate)) {
    errors.dispatchDate = "A valid dispatch date is required.";
  }

  const season = trimmed(raw.season);
  if (!season) errors.season = "A season is required.";

  const readinessThreshold = toNumber(raw.readinessThreshold);
  if (
    readinessThreshold === null ||
    readinessThreshold < 0 ||
    readinessThreshold > 1
  ) {
    errors.readinessThreshold = "Readiness threshold must be between 0 and 1.";
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
      crewId,
      dispatchDate,
      season,
      readinessThreshold: readinessThreshold as number,
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
 * method `generate_dispatch` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface GenerateDispatchStore {
  rpc(fn: "generate_dispatch", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the new run id, or friendly/labelled errors. */
export type GenerateDispatchResult =
  | { ok: true; runId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then generate: calls `generate_dispatch` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the originally created run
 * id, no second run.
 */
export async function generateDispatch(
  store: GenerateDispatchStore,
  raw: Record<string, unknown>,
): Promise<GenerateDispatchResult> {
  const parsed = validateGenerateDispatch(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("generate_dispatch", {
    p_crew_id: parsed.data.crewId,
    p_dispatch_date: parsed.data.dispatchDate,
    p_season: parsed.data.season,
    p_readiness_threshold: parsed.data.readinessThreshold,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `generate_dispatch: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "generate_dispatch: no run id returned" };
  }
  return { ok: true, runId: data };
}
