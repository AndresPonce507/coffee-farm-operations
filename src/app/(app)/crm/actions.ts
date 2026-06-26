"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";
import type { ContactEventKind, ContactKind, ContactStatus } from "./data";

/**
 * /crm WRITE port — the CRM Server Actions (P3-S18 direct-trade CRM).
 *
 * Server Actions are the one driving port (rail §7 injection invariant: every write
 * here is invoked by an AUTHENTICATED HUMAN submitting a form — never by an untrusted
 * inbound email/WhatsApp/webhook). Each validates the shape the DB enforces BEFORE the
 * network hop, then appends through a single SECURITY DEFINER command RPC:
 *   • upsert_contact         — the ONLY contacts writer; a consent flip is appended as
 *     a consent_granted/consent_withdrawn event in the same txn (auditable lawful basis).
 *   • record_contact_event   — a relationship touchpoint onto the append-only ledger;
 *     consent kinds are refused here (consent state moves only via upsert_contact).
 *   • record_sample_dispatch — the MONEY-SHAPED, human-confirmed write: a sample is real
 *     green leaving inventory, so it inserts an oversell-guarded sample_dispatches row
 *     (prevent_oversell fires there — no parallel counter; oversell ⇒ the whole txn rolls
 *     back). grams→kg routes through convert_qty inside the RPC (never a hardcoded /1000).
 *   • record_sample_feedback — the buyer's cup verdict, appended as new evidence (the
 *     dispatch row is immutable; a verdict is never a column rewrite).
 *
 * The regime guards, consent lawful-basis CHECK, and oversell trigger all live in the
 * database; these actions surface the author-written guard messages verbatim (they are
 * family-readable) and map structural Postgres errors to clean copy — never a raw
 * SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry
 * collapses to the same row.
 *
 * REVALIDATION: a contact upsert / relationship event moves no consumer route outside
 * /crm (and the (app) shell is force-dynamic, so a same-session nav re-renders fresh),
 * so those bust nothing. A SAMPLE DISPATCH commits green ATP, so it fans out through
 * reactiveRefresh — the RIPPLE SSOT — on the existing "inventory-update" kind (the same
 * green-inventory seam accept_quote rides). Wiring may later add a dedicated CRM kind +
 * /crm routes to the ripple map (a shared-contract file, single-author in the Wiring pass).
 */

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (consent lawful basis, oversell, held-lot,
 * unknown contact/lot) — all safe and clear, so they pass through verbatim. Structural
 * codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown contact / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to do that.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already saved.";
    default:
      return generic;
  }
}

const clean = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/* ───────────────────────────── upsert_contact ───────────────────────────── */

export interface UpsertContactInput {
  /** null ⇒ create; a value ⇒ update that contact. */
  contactId: number | null;
  name: string;
  kind: ContactKind;
  status: ContactStatus;
  countryCode: string | null;
  email: string | null;
  phone: string | null;
  buyerId: number | null;
  consentMarketing: boolean;
  consentSource: string | null;
  idempotencyKey: string;
}

export type UpsertContactResult =
  | { ok: true; contactId: number }
  | { ok: false; error: string };

export async function upsertContactAction(
  input: UpsertContactInput,
): Promise<UpsertContactResult> {
  const t = await getTranslations("crm");
  if (!input.name?.trim()) {
    return { ok: false, error: t("errors.nameRequired") };
  }
  if (!input.kind) {
    return { ok: false, error: t("errors.kindRequired") };
  }
  // Lawful basis mirrored at the UI seam: consent=true MUST name its source (the DB
  // CHECK is the real wall; this surfaces it before the network hop).
  if (input.consentMarketing && !input.consentSource?.trim()) {
    return { ok: false, error: t("errors.consentSourceRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("upsert_contact", {
    p_contact_id: input.contactId,
    p_name: input.name.trim(),
    p_kind: input.kind,
    p_status: input.status,
    p_country_code: clean(input.countryCode),
    p_email: clean(input.email),
    p_phone: clean(input.phone),
    p_buyer_id: input.buyerId,
    p_consent_marketing: input.consentMarketing,
    p_consent_source: clean(input.consentSource),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, contactId: Number(data) };
}

/* ─────────────────────────── record_contact_event ───────────────────────── */

export interface ContactEventInput {
  contactId: number;
  kind: ContactEventKind;
  note: string | null;
  idempotencyKey: string;
}

export type ContactEventResult = { ok: true } | { ok: false; error: string };

export async function recordContactEventAction(
  input: ContactEventInput,
): Promise<ContactEventResult> {
  const t = await getTranslations("crm");
  if (!input.kind) {
    return { ok: false, error: t("errors.eventKindRequired") };
  }
  // Consent state is never forged here — it flips only via upsert_contact, which moves
  // the flag AND appends the event atomically. Mirrors the DB's record_contact_event guard.
  if (input.kind === "consent_granted" || input.kind === "consent_withdrawn") {
    return { ok: false, error: t("errors.consentKindForbidden") };
  }
  if (!Number.isInteger(input.contactId) || input.contactId <= 0) {
    return { ok: false, error: t("errors.contactRequired") };
  }

  const note = clean(input.note);
  const sb = await getSupabase();
  const { error } = await sb.rpc("record_contact_event", {
    p_contact_id: input.contactId,
    p_kind: input.kind,
    p_payload: note ? { note } : {},
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true };
}

/* ────────────────────────── record_sample_dispatch ──────────────────────── */

export interface SampleDispatchInput {
  greenLotCode: string;
  contactId: number;
  grams: number;
  courier: string | null;
  trackingNo: string | null;
  idempotencyKey: string;
}

export type SampleDispatchResult =
  | { ok: true; sampleId: number }
  | { ok: false; error: string };

export async function recordSampleDispatchAction(
  input: SampleDispatchInput,
): Promise<SampleDispatchResult> {
  const t = await getTranslations("crm");
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!Number.isInteger(input.contactId) || input.contactId <= 0) {
    return { ok: false, error: t("errors.contactRequired") };
  }
  if (!(Number.isFinite(input.grams) && input.grams > 0)) {
    return { ok: false, error: t("errors.gramsPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_sample_dispatch", {
    p_green_lot_code: input.greenLotCode.trim(),
    p_contact_id: input.contactId,
    p_grams: input.grams,
    p_courier: clean(input.courier),
    p_tracking_no: clean(input.trackingNo),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // The sample drew green ATP (an oversell-guarded sample_dispatches row): green
  // inventory moved, so fan out the ripple on the existing inventory-update seam.
  reactiveRefresh("inventory-update");
  return { ok: true, sampleId: Number(data) };
}

/* ────────────────────────── record_sample_feedback ──────────────────────── */

export interface SampleFeedbackInput {
  sampleDispatchId: number;
  score: number | null;
  verdict: "approved" | "rejected" | "counter" | string;
  notes: string | null;
  idempotencyKey: string;
}

export type SampleFeedbackResult = { ok: true } | { ok: false; error: string };

const VERDICTS = new Set(["approved", "rejected", "counter"]);

export async function recordSampleFeedbackAction(
  input: SampleFeedbackInput,
): Promise<SampleFeedbackResult> {
  const t = await getTranslations("crm");
  if (!Number.isInteger(input.sampleDispatchId) || input.sampleDispatchId <= 0) {
    return { ok: false, error: t("errors.sampleRequired") };
  }
  if (!VERDICTS.has(input.verdict)) {
    return { ok: false, error: t("errors.verdictRequired") };
  }

  const sb = await getSupabase();
  const { error } = await sb.rpc("record_sample_feedback", {
    p_sample_dispatch_id: input.sampleDispatchId,
    p_score: input.score,
    p_verdict: input.verdict,
    p_notes: clean(input.notes),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true };
}
