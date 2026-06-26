"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";
import type { SampleKind } from "./data";

/**
 * /sales/samples WRITE port — the sample-tracking Server Actions (P3-S2).
 *
 * Server Actions are the one driving port (the injection invariant, rail §7: only an
 * authenticated human submitting a form ever invokes them — no untrusted inbound fires
 * a write). Each validates the shape the DB enforces BEFORE the network hop, then
 * appends through a single SECURITY DEFINER command RPC:
 *   • log_sample            — logs a dispatched sample; for sample_kind='pre_shipment'
 *     it draws ATP first (a lot_shipments INSERT → the EXISTING prevent_oversell
 *     trigger fires; grams→kg via convert_qty, NEVER a hardcoded /1000), so a sample
 *     cannot be pulled from a lot already fully committed.
 *   • record_sample_verdict — writes the buyer's score/verdict as owner; an 'approved'
 *     pre-shipment verdict is the keystone that unlocks signing a reserve contract.
 *
 * Author-written guard messages (oversell, unknown buyer/sample, bad verdict) are
 * family-readable and pass through verbatim; structural Postgres errors map to clean
 * copy — never a raw SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1).
 *
 * REVALIDATION: a pre-shipment draw commits a lot_shipments row (green inventory / ATP
 * moves), so it fans out through reactiveRefresh, the RIPPLE SSOT (never a hand-rolled
 * revalidatePath — the ripple-actions-wired guard). offer/type/arbitration samples and
 * verdict writes move no shared-inventory read, so they bust nothing server-side (the
 * board re-reads on the client island's router.refresh()).
 *
 * WIRING SEAM (out of this slice's file scope — src/lib/revalidate.ts is a shared
 * contract file edited single-author in the Wiring pass): a pre-shipment draw currently
 * rides the existing "inventory-update" kind (ATP is green inventory). Wiring may add a
 * dedicated "sample-logged" EventKind whose RIPPLE routes include /sales/samples +
 * /inventory, register this action file in the guard's KIND_TO_ACTION_FILES, and
 * repoint this call.
 */

export interface LogSampleInput {
  greenLotCode: string;
  /** null ⇒ a spec/type sample with no requesting buyer. */
  buyerId: number | null;
  sampleKind: SampleKind;
  grams: number;
  courier: string | null;
  trackingNo: string | null;
  idempotencyKey: string;
}

export interface RecordVerdictInput {
  sampleId: number;
  /** null ⇒ a verdict without a number. */
  buyerScore: number | null;
  buyerVerdict: "approved" | "rejected" | "counter";
  idempotencyKey: string;
}

export type SampleResult =
  | { ok: true; sampleId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The P3-S2 SECURITY DEFINER guards
 * raise author-written messages with these SQLSTATEs (oversell on a pre-shipment draw,
 * unknown buyer/sample, an invalid verdict) — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages (oversell, verdict)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown buyer / sample / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to log samples for this lot.";
    case "23505": // unique_violation — idempotent replay collided
      return "That sample was already logged.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** Trim a maybe-blank optional string to null (never store an empty string). */
const orNull = (v: string | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export async function logSampleAction(
  input: LogSampleInput,
): Promise<SampleResult> {
  const t = await getTranslations("samples");
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!["offer", "pre_shipment", "type", "arbitration"].includes(input.sampleKind)) {
    return { ok: false, error: t("errors.kindRequired") };
  }
  if (!isPositive(input.grams)) {
    return { ok: false, error: t("errors.gramsPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("log_sample", {
    p_green_lot_code: input.greenLotCode.trim(),
    p_buyer_id: input.buyerId,
    p_sample_kind: input.sampleKind,
    p_grams: input.grams,
    p_courier: orNull(input.courier),
    p_tracking_no: orNull(input.trackingNo),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // A pre-shipment draw committed a lot_shipments row: green inventory / ATP moved.
  if (input.sampleKind === "pre_shipment") {
    reactiveRefresh("inventory-update");
  }
  return { ok: true, sampleId: Number(data) };
}

export async function recordVerdictAction(
  input: RecordVerdictInput,
): Promise<SampleResult> {
  const t = await getTranslations("samples");
  if (!Number.isInteger(input.sampleId) || input.sampleId <= 0) {
    return { ok: false, error: t("errors.sampleRequired") };
  }
  if (!["approved", "rejected", "counter"].includes(input.buyerVerdict)) {
    return { ok: false, error: t("errors.verdictRequired") };
  }
  if (
    input.buyerScore != null &&
    !(Number.isFinite(input.buyerScore) && input.buyerScore >= 0 && input.buyerScore <= 100)
  ) {
    return { ok: false, error: t("errors.scoreRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_sample_verdict", {
    p_sample_id: input.sampleId,
    p_buyer_score: input.buyerScore,
    p_buyer_verdict: input.buyerVerdict,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // A verdict moves no shared-inventory read; the board refreshes on the client.
  return { ok: true, sampleId: Number(data) };
}
