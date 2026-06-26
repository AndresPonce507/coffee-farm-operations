"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";
import type { BuyerType, PricingBasis } from "./data";

/**
 * /sales/contracts WRITE port — create-contract + create-buyer Server Actions (P3-S1).
 *
 * One driving port (ADR-002: only ever invoked by an authenticated human submitting a
 * form — the injection invariant, rail §7). Each validates the shape the DB enforces
 * BEFORE the network hop, then appends through a single SECURITY DEFINER RPC:
 *   • create_sales_contract — mints a gap-free JC-K-NNNN under an advisory lock.
 *   • create_b2b_buyer      — the buyer CRM-master writer (extended by P3-S18).
 *
 * Neither commits green inventory (a draft contract claims nothing; the claim lands on
 * add_contract_line), so no ATP ripple fires. The board re-reads on navigation (the
 * (app) is force-dynamic); the client island refreshes in place after a write.
 */

export interface CreateContractInput {
  buyerId: number;
  incoterm: string;
  incotermNamedPlace: string | null;
  contractStandard: "GCA" | "ECF" | "custom" | null;
  pricingBasis: PricingBasis;
  currency: string;
  idempotencyKey: string;
}

export interface CreateBuyerInput {
  name: string;
  countryCode: string | null;
  buyerType: BuyerType | null;
  defaultIncoterm: string | null;
  defaultCurrency: string;
  idempotencyKey: string;
}

export type CreateContractResult =
  | { ok: true; contractId: number }
  | { ok: false; error: string };

export type CreateBuyerResult =
  | { ok: true; buyerId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard
    case "P0001": // raise_exception
    case "23503": // foreign_key_violation — unknown buyer
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to do that.";
    case "23505": // unique_violation — idempotent replay collided
      return generic;
    default:
      return generic;
  }
}

export async function createContractAction(
  input: CreateContractInput,
): Promise<CreateContractResult> {
  const t = await getTranslations("sales");
  if (!Number.isInteger(input.buyerId) || input.buyerId <= 0) {
    return { ok: false, error: t("contracts.errors.buyerRequired") };
  }
  if (!input.incoterm?.trim()) {
    return { ok: false, error: t("contracts.errors.incotermRequired") };
  }
  if (!input.pricingBasis?.trim()) {
    return { ok: false, error: t("contracts.errors.basisRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_sales_contract", {
    p_buyer_id: input.buyerId,
    p_incoterm: input.incoterm.trim(),
    p_incoterm_named_place: input.incotermNamedPlace?.trim() || null,
    p_contract_standard: input.contractStandard,
    p_pricing_basis: input.pricingBasis,
    p_currency: input.currency?.trim() || "USD",
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("contracts.errors.generic")),
    };
  }
  return { ok: true, contractId: Number(data) };
}

export async function createBuyerAction(
  input: CreateBuyerInput,
): Promise<CreateBuyerResult> {
  const t = await getTranslations("sales");
  if (!input.name?.trim()) {
    return { ok: false, error: t("contracts.errors.nameRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_b2b_buyer", {
    p_name: input.name.trim(),
    p_country_code: input.countryCode?.trim().toUpperCase() || null,
    p_buyer_type: input.buyerType,
    p_default_incoterm: input.defaultIncoterm?.trim() || null,
    p_default_currency: input.defaultCurrency?.trim() || "USD",
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("contracts.errors.buyerGeneric")),
    };
  }
  return { ok: true, buyerId: Number(data) };
}
