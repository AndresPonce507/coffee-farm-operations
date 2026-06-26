import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for a contact's own opt-out (P3-S20 — CAN-SPAM/GDPR; ADR-002).
 * `record_unsubscribe` stamps `unsubscribed_at`, withdraws marketing consent, and
 * logs a hash-chained 'consent_withdrawn' contact_event. Suppression only REMOVES
 * capability (it can never trigger a send or a money write), so auto-applying a
 * contact's own opt-out honours the no-untrusted-inbound rail — and once set, no
 * later campaign can target that row (the audience view + the consent guard exclude
 * it). The RPC returns VOID, so the command resolves to a bare `{ ok: true }` on
 * success — there is no id. Idempotent + tenant-clamped.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs. The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped unsubscribe args (camelCase). */
export interface RecordUnsubscribeInput {
  contactId: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw unsubscribe — a real contact id + an idempotency key.
 * The consent withdrawal + the 'consent_withdrawn' event + idempotency are the RPC's
 * job (the migration's PGlite tests).
 */
export function validateRecordUnsubscribe(
  raw: Record<string, unknown>,
): ValidationResult<RecordUnsubscribeInput> {
  const errors: Record<string, string> = {};

  const contactId = toNumber(raw.contactId ?? raw.id);
  if (contactId === null || !Number.isInteger(contactId) || contactId <= 0) {
    errors.contactId = "Choose a contact to unsubscribe.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { contactId: contactId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (void → null data). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `record_unsubscribe` needs. */
export interface RecordUnsubscribeStore {
  rpc(
    fn: "record_unsubscribe",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: success (no id — the RPC returns void), or errors. */
export type RecordUnsubscribeResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_unsubscribe` onto a family-readable
 * sentence (the unknown-contact rejection). Returns null for anything unrecognised.
 */
export function friendlyRecordUnsubscribeError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown contact|foreign key/.test(m)) {
    return "That contact couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then unsubscribe: calls `record_unsubscribe` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * the unknown-contact rejection surfaces as a CLEAN sentence, any other failure
 * labelled. The RPC returns void, so success is a bare `{ ok: true }` — `data` is
 * NOT checked for null (null is the normal void return). Exactly-once on the key.
 */
export async function recordUnsubscribe(
  store: RecordUnsubscribeStore,
  raw: Record<string, unknown>,
): Promise<RecordUnsubscribeResult> {
  const parsed = validateRecordUnsubscribe(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { error } = await store.rpc("record_unsubscribe", {
    p_contact_id: parsed.data.contactId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordUnsubscribeError(error) ??
        `Couldn't record the unsubscribe: ${error.message}`,
    };
  }
  return { ok: true };
}
