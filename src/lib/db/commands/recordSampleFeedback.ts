import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the buyer's cup verdict on a dispatched sample (P3-S18;
 * ADR-002). `record_sample_feedback` appends an APPEND-ONLY 'sample_feedback' event
 * onto the contact timeline — the `sample_dispatches` row is immutable, so a verdict
 * is NEW evidence, never a column rewrite. The verdict is constrained to
 * approved|rejected|counter (mirrored here; the RPC CHECK is the real enforcement);
 * score + notes are optional. The RPC returns the new event's uuid, coerced to a
 * string, and is idempotent on a tenant-qualified key.
 *
 * Symmetric twin of the read port: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `RecordSampleFeedbackStore` port), testable with no DB.
 */

/** The sample-verdict values — mirrors the RPC's `approved|rejected|counter` CHECK. */
export const SAMPLE_VERDICTS = ["approved", "rejected", "counter"] as const;
export type SampleVerdict = (typeof SAMPLE_VERDICTS)[number];

/** Validated, domain-shaped feedback args (camelCase). */
export interface RecordSampleFeedbackInput {
  sampleDispatchId: number;
  /** The buyer's cup score; null when a verdict stands without a number. */
  score: number | null;
  verdict: SampleVerdict;
  notes: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

function isSampleVerdict(v: string): v is SampleVerdict {
  return (SAMPLE_VERDICTS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw feedback — mirrors `record_sample_feedback`'s
 * preconditions (a real dispatch id, the verdict enum) so errors surface before the
 * round-trip. The RPC's verdict CHECK + tenant clamp are the actual enforcement.
 */
export function validateRecordSampleFeedback(
  raw: Record<string, unknown>,
): ValidationResult<RecordSampleFeedbackInput> {
  const errors: Record<string, string> = {};

  const sampleDispatchId = toNumber(raw.sampleDispatchId);
  if (
    sampleDispatchId === null ||
    !Number.isInteger(sampleDispatchId) ||
    sampleDispatchId <= 0
  ) {
    errors.sampleDispatchId = "Choose a sample dispatch.";
  }

  const verdictRaw = trimmed(raw.verdict);
  if (!isSampleVerdict(verdictRaw)) {
    errors.verdict = "Choose a verdict (approved, rejected, or counter).";
  }

  // Blank score ⇒ null (a verdict can stand without a number). A supplied score
  // must be numeric.
  const scoreRaw = trimmed(raw.score);
  let score: number | null = null;
  if (scoreRaw) {
    const n = toNumber(raw.score);
    if (n === null) {
      errors.score = "A cup score must be a number.";
    } else {
      score = n;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      sampleDispatchId: sampleDispatchId as number,
      score,
      verdict: verdictRaw as SampleVerdict,
      notes: trimmed(raw.notes) || null,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (a uuid event_uid). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `record_sample_feedback` needs. */
export interface RecordSampleFeedbackStore {
  rpc(
    fn: "record_sample_feedback",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the event uid, or friendly/labelled errors. */
export type RecordSampleFeedbackResult =
  | { ok: true; eventUid: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then record: calls `record_sample_feedback` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * a failure surfaces labelled (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same event uid with no second append.
 */
export async function recordSampleFeedback(
  store: RecordSampleFeedbackStore,
  raw: Record<string, unknown>,
): Promise<RecordSampleFeedbackResult> {
  const parsed = validateRecordSampleFeedback(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_sample_feedback", {
    p_sample_dispatch_id: parsed.data.sampleDispatchId,
    p_score: parsed.data.score,
    p_verdict: parsed.data.verdict,
    p_notes: parsed.data.notes,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't save the feedback: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The feedback couldn't be saved. Please try again." };
  }
  return { ok: true, eventUid: String(data) };
}
