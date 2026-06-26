"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/contracts/[no] WRITE port — add-line + sign Server Actions (P3-S1).
 *
 * One driving port (ADR-002: only ever an authenticated human submitting a form — the
 * injection invariant, rail §7). Each validates the shape the DB enforces BEFORE the
 * network hop, then appends through a single SECURITY DEFINER RPC:
 *   • add_contract_line  — inserts the lot_reservations CLAIM FIRST, so the EXISTING
 *     prevent_oversell trigger fires there (no parallel counter); an over-claim rolls
 *     the whole txn back. THIS is where green inventory / ATP moves.
 *   • sign_sales_contract — requires ≥1 line + draft; appends 'contract_signed' per
 *     distinct lot. A legal instrument: human-confirmed, online-first (rail §9). It
 *     moves no inventory (status flip + events only).
 *
 * REVALIDATION: add_contract_line commits a lot_reservations row (ATP moves), so it
 * fans out through reactiveRefresh — the RIPPLE SSOT — on the existing "inventory-
 * update" kind (ATP is green inventory). The Wiring pass can later add a dedicated
 * "contract-line"/"contract-signed" EventKind whose routes include the /sales surfaces.
 * The workspace island also router.refresh()es to reconcile this page in place.
 */

export interface AddContractLineInput {
  contractId: number;
  greenLotCode: string;
  kg: number;
  /** $/kg for a fixed-basis line; null for differential/auction (price set later). */
  unitPrice: number | null;
  differentialCents: number | null;
  iceCMonth: string | null;
  idempotencyKey: string;
}

export interface SignContractInput {
  contractId: number;
  idempotencyKey: string;
}

export type AddLineResult =
  | { ok: true; lineId: number }
  | { ok: false; error: string };

export type SignResult =
  | { ok: true; contractId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — oversell / regime / status / no-lines guards
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation — unknown contract / lot
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to do that.";
    case "23505": // unique_violation — idempotent replay collided
      return generic;
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export async function addContractLineAction(
  input: AddContractLineInput,
): Promise<AddLineResult> {
  const t = await getTranslations("sales");
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("workspace.errors.lotRequired") };
  }
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("workspace.errors.kgPositive") };
  }
  if (input.unitPrice != null && !(Number.isFinite(input.unitPrice) && input.unitPrice >= 0)) {
    return { ok: false, error: t("workspace.errors.pricePositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("add_contract_line", {
    p_contract_id: input.contractId,
    p_green_lot_code: input.greenLotCode.trim(),
    p_kg: input.kg,
    p_unit_price: input.unitPrice,
    p_differential_cents: input.differentialCents,
    p_ice_c_contract_month: input.iceCMonth?.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("workspace.errors.generic")),
    };
  }

  // add_contract_line inserted a lot_reservations row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, lineId: Number(data) };
}

export async function signContractAction(
  input: SignContractInput,
): Promise<SignResult> {
  const t = await getTranslations("sales");
  if (!Number.isInteger(input.contractId) || input.contractId <= 0) {
    return { ok: false, error: t("workspace.errors.signGeneric") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("sign_sales_contract", {
    p_contract_id: input.contractId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("workspace.errors.signGeneric")),
    };
  }
  return { ok: true, contractId: Number(data) };
}
