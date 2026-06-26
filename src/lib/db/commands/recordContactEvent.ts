import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for logging a relationship event onto a contact's APPEND-ONLY,
 * hash-chained timeline (P3-S18; ADR-002 — every write flows through a SECURITY
 * DEFINER RPC). `record_contact_event` REFUSES the consent kinds
 * ('consent_granted'/'consent_withdrawn') — consent state changes only via
 * `upsert_contact`, which flips the `contacts` flag AND appends the event in one
 * txn, never forged independently — so the validator rejects them client-side too.
 * The RPC returns the new event's uuid (`event_uid`), coerced to a string. An
 * inbound adapter (buyer email / WhatsApp reply) would call THIS — never the
 * money-shaped `record_sample_dispatch` (the injection invariant).
 *
 * Symmetric twin of the read port: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `RecordContactEventStore` port), testable with no DB.
 */

/** The contact_event_kind values that a CLIENT may log (consent kinds excluded —
 *  those are owned by `upsert_contact`). */
export const CONTACT_EVENT_KINDS = [
  "inquiry",
  "sample_requested",
  "sample_sent",
  "sample_feedback",
  "quote_sent",
  "meeting",
  "call",
  "note",
] as const;
export type ContactEventKind = (typeof CONTACT_EVENT_KINDS)[number];

/** The consent kinds the RPC refuses (owned by `upsert_contact`). */
const CONSENT_KINDS = ["consent_granted", "consent_withdrawn"] as const;

/** Validated, domain-shaped event args (camelCase). */
export interface RecordContactEventInput {
  contactId: number;
  kind: ContactEventKind;
  /** Arbitrary jsonb evidence; defaults to an empty object. */
  payload: Record<string, unknown>;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

function isContactEventKind(v: string): v is ContactEventKind {
  return (CONTACT_EVENT_KINDS as readonly string[]).includes(v);
}

function isConsentKind(v: string): boolean {
  return (CONSENT_KINDS as readonly string[]).includes(v);
}

/** A plain JSON object? (arrays/null/primitives are not accepted as a payload). */
function asPayload(v: unknown): Record<string, unknown> {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/**
 * Pure validation of a raw event — mirrors `record_contact_event`'s preconditions
 * (a real contact id, a non-consent kind) so errors surface before the round-trip.
 * The RPC's consent refusal + tenant clamp are the actual enforcement (ADR-002).
 */
export function validateRecordContactEvent(
  raw: Record<string, unknown>,
): ValidationResult<RecordContactEventInput> {
  const errors: Record<string, string> = {};

  const contactId = toNumber(raw.contactId);
  if (contactId === null || !Number.isInteger(contactId) || contactId <= 0) {
    errors.contactId = "Choose a contact.";
  }

  const kindRaw = trimmed(raw.kind);
  if (isConsentKind(kindRaw)) {
    errors.kind =
      "Consent changes are recorded by editing the contact, not as a timeline note.";
  } else if (!isContactEventKind(kindRaw)) {
    errors.kind = "Choose a valid event type.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contactId: contactId as number,
      kind: kindRaw as ContactEventKind,
      payload: asPayload(raw.payload),
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (a uuid event_uid). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `record_contact_event` needs. */
export interface RecordContactEventStore {
  rpc(
    fn: "record_contact_event",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the event uid, or friendly/labelled errors. */
export type RecordContactEventResult =
  | { ok: true; eventUid: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then log: calls `record_contact_event` exactly once with the snake_case
 * argument envelope. Bad input (incl. a forged consent kind) never reaches the RPC;
 * a failure surfaces labelled (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same event uid with no second append.
 */
export async function recordContactEvent(
  store: RecordContactEventStore,
  raw: Record<string, unknown>,
): Promise<RecordContactEventResult> {
  const parsed = validateRecordContactEvent(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_contact_event", {
    p_contact_id: parsed.data.contactId,
    p_kind: parsed.data.kind,
    p_payload: parsed.data.payload,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't log the event: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The event couldn't be logged. Please try again." };
  }
  return { ok: true, eventUid: String(data) };
}
