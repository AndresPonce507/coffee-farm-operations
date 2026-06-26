import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the money-shaped sample-dispatch writer (P3-S18). A B2B
 * sample is real green LEAVING inventory, so `record_sample_dispatch` inserts a
 * `sample_dispatches` row inside the SECURITY DEFINER RPC (grams→kg via
 * `convert_qty`, never a hardcoded /1000) — firing the EXTENDED `prevent_oversell`
 * (now a THREE-claim guard: reservations + shipments + samples) and the
 * `_prevent_held_lot_commit` QC guard. The money guarantee is REUSED, not rebuilt:
 * a free sample can never silently consume inventory a paid buyer reserved, and ATP
 * never goes negative. An over-commit or a QC-held lot rolls the WHOLE transaction
 * back. The RPC also appends a 'sample_dispatched' lot_event + a 'sample_sent'
 * contact event, and is idempotent on a tenant-qualified key.
 *
 * Symmetric twin of the read port: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `RecordSampleDispatchStore` port), testable with no
 * DB. Surfaces the fail-closed oversell / QC-hold rejections as CLEAN sentences.
 */

/** Validated, domain-shaped dispatch args (camelCase). */
export interface RecordSampleDispatchInput {
  greenLotCode: string;
  contactId: number;
  /** Sample weight in grams (the grams > 0 CHECK; the RPC converts to the kg ATP draw). */
  grams: number;
  courier: string | null;
  trackingNo: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw dispatch — mirrors `record_sample_dispatch` / the
 * `grams > 0` CHECK so errors surface before the round-trip. The oversell / QC-hold
 * triggers fired by the dispatch insert are the actual enforcement.
 */
export function validateRecordSampleDispatch(
  raw: Record<string, unknown>,
): ValidationResult<RecordSampleDispatchInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const contactId = toNumber(raw.contactId);
  if (contactId === null || !Number.isInteger(contactId) || contactId <= 0) {
    errors.contactId = "Choose a contact.";
  }

  const grams = toNumber(raw.grams);
  if (grams === null || grams <= 0) {
    errors.grams = "The sample weight must be greater than 0 grams.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      contactId: contactId as number,
      grams: grams as number,
      courier: trimmed(raw.courier) || null,
      trackingNo: trimmed(raw.trackingNo) || null,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint dispatch id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `record_sample_dispatch` needs. */
export interface RecordSampleDispatchStore {
  rpc(
    fn: "record_sample_dispatch",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the dispatch id, or friendly/labelled errors. */
export type RecordSampleDispatchResult =
  | { ok: true; sampleId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_sample_dispatch` onto a family-readable
 * sentence — the EXTENDED money guarantee is the real guard, but the family must
 * never see raw PG text (`oversell guard:` / `qc-hold:` engine prefixes, errcodes).
 * Returns null for anything unrecognised so the caller can fall back to a generic
 * labelled message.
 */
export function friendlyRecordSampleDispatchError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The EXTENDED money guarantee — the sample insert hit prevent_oversell (the
  // third claim term: a free sample can't oversell what a paid buyer reserved).
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this lot to send that sample. Lower the grams or pick another lot.";
  }
  // The QC-hold commit block (_prevent_held_lot_commit).
  if (/qc-hold|open qc-hold|reserved or shipped/.test(m)) {
    return "This lot is under an open QC hold and can't be sampled yet. Release the hold first.";
  }
  // Unknown contact / green lot.
  if (error.code === "23503" || /unknown (contact|green lot)|foreign key/.test(m)) {
    return "That contact or green lot couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then dispatch: calls `record_sample_dispatch` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * the fail-closed oversell / QC-hold rejections surface as CLEAN sentences, any
 * other failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay
 * returns the same dispatch id with no second claim against ATP.
 */
export async function recordSampleDispatch(
  store: RecordSampleDispatchStore,
  raw: Record<string, unknown>,
): Promise<RecordSampleDispatchResult> {
  const parsed = validateRecordSampleDispatch(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_sample_dispatch", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_contact_id: parsed.data.contactId,
    p_grams: parsed.data.grams,
    p_courier: parsed.data.courier,
    p_tracking_no: parsed.data.trackingNo,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordSampleDispatchError(error) ??
        "This sample couldn't be dispatched right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This sample couldn't be dispatched right now. Please try again." };
  }
  return { ok: true, sampleId: Number(data) };
}
