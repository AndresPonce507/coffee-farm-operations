import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for recording a buyer's VERDICT on a B2B sample (P3-S2; ADR-002 —
 * all writes flow through a SECURITY DEFINER command RPC). The single write door is
 * `record_sample_verdict` — the verdict is written AS OWNER (the `green_samples` table
 * has no client UPDATE grant; a buyer-facing append posts the dispatch, the owner stamps
 * the verdict). Tenant-clamped, idempotent on a tenant-qualified key.
 *
 * THE KEYSTONE the RPC owns: an 'approved' verdict appends a `sample_approved` lot_event
 * — and an approved PRE-SHIPMENT sample is what unlocks `sign_sales_contract` for a
 * reserve contract (the sample-approval-as-contract-prereq invariant). A 'counter' can
 * later be superseded by 'approved'; replaying the SAME verdict is a no-op (idempotent).
 * Those state rules are the RPC's job (proven by the migration's PGlite tests); this
 * command is the friendly-validation seam + clean error translation.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls the
 * one `.rpc()` it needs (the `RecordSampleVerdictStore` port), testable with no database.
 * The buyer score is OPTIONAL (blank ⇒ null — a verdict without a number); when provided
 * it must be in [0,100]. The verdict is REQUIRED; the idempotency key is REQUIRED.
 */

/** The `buyer_verdict` CHECK values — a buyer's cupping decision on a sample. */
export const BUYER_VERDICTS = ["approved", "rejected", "counter"] as const;
export type BuyerVerdict = (typeof BUYER_VERDICTS)[number];

/** Validated, domain-shaped verdict args (camelCase). */
export interface RecordSampleVerdictInput {
  /** The `green_samples.id` the verdict applies to (a positive integer). */
  sampleId: number;
  /** The buyer's score in [0,100]; null ⇒ a verdict without a number. */
  buyerScore: number | null;
  buyerVerdict: BuyerVerdict;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Is `v` one of the recognised verdicts? (mirrors the `buyer_verdict` CHECK) */
function isBuyerVerdict(v: string): v is BuyerVerdict {
  return (BUYER_VERDICTS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw verdict — mirrors the `record_sample_verdict` / `green_samples`
 * constraints (a real sample id, the verdict enum, the score in [0,100]) so errors surface
 * before the round-trip. The supersession/idempotency state machine + the tenant clamp are
 * the actual enforcement (ADR-002).
 */
export function validateRecordSampleVerdict(
  raw: Record<string, unknown>,
): ValidationResult<RecordSampleVerdictInput> {
  const errors: Record<string, string> = {};

  const sampleId = toNumber(raw.sampleId);
  if (sampleId === null || !Number.isInteger(sampleId) || sampleId <= 0) {
    errors.sampleId = "Choose a sample to record a verdict for.";
  }

  // score: optional; a verdict may carry no number. When provided it must be in [0,100].
  let buyerScore: number | null = null;
  if (!isBlank(raw.buyerScore)) {
    const s = toNumber(raw.buyerScore);
    if (s === null || s < 0 || s > 100) {
      errors.buyerScore = "Score must be between 0 and 100.";
    } else {
      buyerScore = s;
    }
  }

  const rawVerdict = trimmed(raw.buyerVerdict);
  if (!rawVerdict) {
    errors.buyerVerdict = "Choose a verdict.";
  } else if (!isBuyerVerdict(rawVerdict)) {
    errors.buyerVerdict = "Choose approved, rejected, or counter.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      sampleId: sampleId as number,
      buyerScore,
      buyerVerdict: rawVerdict as BuyerVerdict,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint sample id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_sample_verdict` needs. */
export interface RecordSampleVerdictStore {
  rpc(
    fn: "record_sample_verdict",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the sample's id, or friendly/labelled errors. */
export type RecordSampleVerdictResult =
  | { ok: true; sampleId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_sample_verdict` onto a family-readable sentence —
 * the RPC is the real guard, but the family must never see raw PG text (errcodes, the
 * engine's verdict prefix). Returns null for anything unrecognised so the caller can fall
 * back to a generic labelled message.
 */
export function friendlyRecordSampleVerdictError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The RPC rejected the verdict value (the CHECK / a guard re-stating the enum).
  if (/buyer_verdict|invalid verdict|approved, rejected/.test(m)) {
    return "That verdict isn't valid — choose approved, rejected, or counter.";
  }
  // Unknown sample (not found for this tenant).
  if (
    error.code === "P0002" ||
    error.code === "23503" ||
    /sample .*not found|unknown sample|no such sample|foreign key/.test(m)
  ) {
    return "That sample couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then record: calls `record_sample_verdict` exactly once with the snake_case
 * argument envelope (the optional score forwarded as null when blank). Bad input never
 * reaches the RPC (friendly errors); a rejection surfaces as a CLEAN sentence, any other
 * failure surfaces labelled. Exactly-once on `idempotencyKey` — replaying the same verdict
 * returns the same sample id with no second event.
 */
export async function recordSampleVerdict(
  store: RecordSampleVerdictStore,
  raw: Record<string, unknown>,
): Promise<RecordSampleVerdictResult> {
  const parsed = validateRecordSampleVerdict(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_sample_verdict", {
    p_sample_id: parsed.data.sampleId,
    p_buyer_score: parsed.data.buyerScore,
    p_buyer_verdict: parsed.data.buyerVerdict,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordSampleVerdictError(error) ??
        "This verdict couldn't be recorded right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This verdict couldn't be recorded right now. Please try again." };
  }
  return { ok: true, sampleId: Number(data) };
}
