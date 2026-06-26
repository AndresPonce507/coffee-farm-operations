import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the ONLY contacts writer (P3-S18 — direct-trade CRM;
 * ADR-002 — every write flows through a SECURITY DEFINER RPC). `upsert_contact`
 * CREATES (contactId null) or UPDATES the mutable CRM anchor, tenant-clamped and
 * idempotent on a tenant-qualified key. The load-bearing lawful-basis rule —
 * marketing consent=true REQUIRES a consent_source (GDPR/CAN-SPAM) — is mirrored
 * here so a missing source surfaces BEFORE the round-trip; the DB CHECK + the RPC
 * raise are the *real* enforcement. A consent FLIP appends a consent event inside
 * the RPC (the auditable trail) — never forged from the client.
 *
 * Symmetric twin of the read port: a pure validator (`validateUpsertContact`) plus
 * a thin command (`upsertContact`) that calls the single `.rpc()` it needs (the
 * `UpsertContactStore` port) so it is testable against a fake store with no database.
 */

/** The `contact_kind` enum values. */
export const CONTACT_KINDS = [
  "roaster",
  "importer",
  "agent",
  "distributor",
  "retailer",
  "press",
  "individual",
  "other",
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** The `contact_status` enum values. */
export const CONTACT_STATUSES = [
  "lead",
  "prospect",
  "active",
  "dormant",
  "lost",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Validated, domain-shaped upsert args (camelCase). */
export interface UpsertContactInput {
  /** The contact to update, or null to CREATE a new one. */
  contactId: number | null;
  name: string;
  kind: ContactKind;
  /** null ⇒ the RPC coalesces to 'lead' on create / keeps the current status on update. */
  status: ContactStatus | null;
  countryCode: string | null;
  email: string | null;
  phone: string | null;
  /** The P3-S1 `b2b_buyers` master link, or null until bound. */
  buyerId: number | null;
  consentMarketing: boolean;
  /** Required whenever `consentMarketing` is true (lawful basis); else null. */
  consentSource: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

function isContactKind(v: string): v is ContactKind {
  return (CONTACT_KINDS as readonly string[]).includes(v);
}

function isContactStatus(v: string): v is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(v);
}

/** Coerce a form/raw value to a boolean (checkbox 'on', "true"/"1", or a real bool). */
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "on" || s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** Optional positive-integer id from a raw value — null when blank, else coerced. */
function optionalId(v: unknown): { ok: true; id: number | null } | { ok: false } {
  const s = trimmed(v);
  if (!s) return { ok: true, id: null };
  const n = toNumber(v);
  if (n === null || !Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, id: n };
}

/**
 * Pure validation of a raw upsert — mirrors the `upsert_contact` / `contacts`
 * constraints (the kind/status enums, the consent-source lawful basis) so errors
 * surface before the round-trip. The tenant clamp + the DB CHECK are the actual
 * enforcement (ADR-002).
 */
export function validateUpsertContact(
  raw: Record<string, unknown>,
): ValidationResult<UpsertContactInput> {
  const errors: Record<string, string> = {};

  const contact = optionalId(raw.contactId);
  if (!contact.ok) errors.contactId = "That contact id isn't valid.";

  const name = trimmed(raw.name);
  if (!name) errors.name = "A contact name is required.";

  const kindRaw = trimmed(raw.kind);
  if (!isContactKind(kindRaw)) errors.kind = "Choose a valid contact type.";

  // Blank status ⇒ null (the RPC defaults / keeps the existing one).
  const statusRaw = trimmed(raw.status);
  let status: ContactStatus | null = null;
  if (statusRaw) {
    if (!isContactStatus(statusRaw)) {
      errors.status = "Choose a valid contact status.";
    } else {
      status = statusRaw;
    }
  }

  const buyer = optionalId(raw.buyerId);
  if (!buyer.ok) errors.buyerId = "That buyer id isn't valid.";

  const consentMarketing = toBool(raw.consentMarketing);
  const consentSource = trimmed(raw.consentSource) || null;
  if (consentMarketing && !consentSource) {
    errors.consentSource =
      "A consent source is required to mark a contact as opted in (lawful basis).";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contactId: contact.ok ? contact.id : null,
      name,
      kind: kindRaw as ContactKind,
      status,
      countryCode: trimmed(raw.countryCode) || null,
      email: trimmed(raw.email) || null,
      phone: trimmed(raw.phone) || null,
      buyerId: buyer.ok ? buyer.id : null,
      consentMarketing,
      consentSource,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint contact id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `upsert_contact` needs. */
export interface UpsertContactStore {
  rpc(
    fn: "upsert_contact",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the contact id, or friendly/labelled errors. */
export type UpsertContactResult =
  | { ok: true; contactId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then upsert: calls `upsert_contact` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); a failure surfaces as a labelled message (raw Postgres
 * text never leaks). Exactly-once on `idempotencyKey` for the CREATE path — a
 * replay returns the same contact id with no second insert.
 */
export async function upsertContact(
  store: UpsertContactStore,
  raw: Record<string, unknown>,
): Promise<UpsertContactResult> {
  const parsed = validateUpsertContact(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("upsert_contact", {
    p_contact_id: parsed.data.contactId,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_status: parsed.data.status,
    p_country_code: parsed.data.countryCode,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_buyer_id: parsed.data.buyerId,
    p_consent_marketing: parsed.data.consentMarketing,
    p_consent_source: parsed.data.consentSource,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't save the contact: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The contact couldn't be saved. Please try again." };
  }
  return { ok: true, contactId: Number(data) };
}
