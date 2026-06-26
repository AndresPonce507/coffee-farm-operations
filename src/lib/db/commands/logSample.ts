import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for LOGGING a B2B sample dispatch (P3-S2 — sample tracking +
 * sample-approval-as-contract-prereq; ADR-002 — all writes flow through a SECURITY
 * DEFINER command RPC). The single write door is `log_sample` — tenant-clamped,
 * idempotent on a tenant-qualified key, appending a `sample_logged` lot_event keyed on
 * the green lot.
 *
 * THE LOAD-BEARING STEP the RPC owns (the data layer, not this command): a
 * `pre_shipment` sample large enough to matter DRAWS ATP — the RPC inserts a
 * `lot_shipments` row first, so the EXISTING `prevent_oversell` BEFORE-INSERT trigger
 * fires (the money guarantee is REUSED, not rebuilt — no parallel counter). An
 * over-draw rolls the whole transaction back; offer/type/arbitration samples claim NO
 * ATP (a documentation-only side ledger). This command's job is the friendly-validation
 * seam and translating an over-draw / unknown lot into clean, family-readable sentences.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls the
 * one `.rpc()` it needs (the `LogSampleStore` port), testable with no database. The
 * buyer is OPTIONAL (blank ⇒ null, a spec/type sample); courier + tracking are OPTIONAL
 * (plain text — NO paid carrier API). The idempotency key is REQUIRED.
 */

/** The `sample_kind` enum — what a dispatched sample is for. */
export const SAMPLE_KINDS = [
  "offer",
  "pre_shipment",
  "type",
  "arbitration",
] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** Validated, domain-shaped sample-dispatch args (camelCase). */
export interface LogSampleInput {
  greenLotCode: string;
  /** The buyer the sample is sent to; null ⇒ a spec/type sample (no buyer). */
  buyerId: number | null;
  sampleKind: SampleKind;
  /** Sample mass (grams) — the `grams > 0` CHECK guards it. */
  grams: number;
  /** Carrier name (plain text); null ⇒ none recorded. */
  courier: string | null;
  /** Tracking number (plain text + public-tracker deep link); null ⇒ none. */
  trackingNo: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Is `v` one of the recognised sample kinds? (mirrors the `sample_kind` enum) */
function isSampleKind(v: string): v is SampleKind {
  return (SAMPLE_KINDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw sample dispatch — mirrors the `log_sample` / `green_samples`
 * constraints (the sample_kind enum, grams > 0, a positive integer buyer FK) so errors
 * surface before the round-trip. The ATP draw's oversell trigger + the tenant clamp are
 * the actual enforcement (ADR-002).
 */
export function validateLogSample(
  raw: Record<string, unknown>,
): ValidationResult<LogSampleInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  // buyer: optional; a spec/type sample has none. When provided it must be a
  // positive integer (the b2b_buyers.id FK).
  let buyerId: number | null = null;
  if (!isBlank(raw.buyerId)) {
    const b = toNumber(raw.buyerId);
    if (b === null || !Number.isInteger(b) || b <= 0) {
      errors.buyerId = "Choose a valid buyer.";
    } else {
      buyerId = b;
    }
  }

  const rawKind = trimmed(raw.sampleKind);
  if (!rawKind) {
    errors.sampleKind = "Choose a sample kind.";
  } else if (!isSampleKind(rawKind)) {
    errors.sampleKind = "Choose a valid sample kind.";
  }

  const grams = toNumber(raw.grams);
  if (grams === null || grams <= 0) {
    errors.grams = "Grams must be greater than 0.";
  }

  // courier + tracking: optional plain text; blank ⇒ null.
  const courier = trimmed(raw.courier) || null;
  const trackingNo = trimmed(raw.trackingNo) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      buyerId,
      sampleKind: rawKind as SampleKind,
      grams: grams as number,
      courier,
      trackingNo,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint sample id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `log_sample` needs. */
export interface LogSampleStore {
  rpc(
    fn: "log_sample",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the logged sample's id, or friendly/labelled errors. */
export type LogSampleResult =
  | { ok: true; sampleId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `log_sample` onto a family-readable sentence — the
 * triggers/RPC are the real guard, but the family must never see raw PG text (the
 * `oversell guard:` engine prefix, errcodes, constraint names). Returns null for
 * anything unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyLogSampleError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — a pre-shipment ATP draw hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this lot to draw that pre-shipment sample. Lower the grams or pick another lot.";
  }
  // The lot is under an open QC hold and can't be committed yet.
  if (/qc-hold|open qc-hold|reserved or shipped/.test(m)) {
    return "This lot is under an open QC hold and can't be drawn from yet. Release the hold first.";
  }
  // Unknown green lot or buyer (the FKs).
  if (error.code === "23503" || /foreign key|unknown green lot|unknown buyer/.test(m)) {
    return "That green lot or buyer couldn't be found. Pick a lot (and buyer) from the list and try again.";
  }
  return null;
}

/**
 * Validate then log: calls `log_sample` exactly once with the snake_case argument
 * envelope. Bad input never reaches the RPC (friendly errors); the fail-closed ATP
 * over-draw / QC-hold rejections surface as CLEAN sentences, any other failure surfaces
 * labelled. Exactly-once on `idempotencyKey` — a replay returns the same sample id with
 * no second insert (and no second ATP draw).
 */
export async function logSample(
  store: LogSampleStore,
  raw: Record<string, unknown>,
): Promise<LogSampleResult> {
  const parsed = validateLogSample(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("log_sample", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_buyer_id: parsed.data.buyerId,
    p_sample_kind: parsed.data.sampleKind,
    p_grams: parsed.data.grams,
    p_courier: parsed.data.courier,
    p_tracking_no: parsed.data.trackingNo,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyLogSampleError(error) ??
        "This sample couldn't be logged right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This sample couldn't be logged right now. Please try again." };
  }
  return { ok: true, sampleId: Number(data) };
}
