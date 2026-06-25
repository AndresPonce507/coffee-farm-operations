"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /pricing WRITE port — the regime-aware quote + accept Server Actions (P3-S0).
 *
 * Server Actions are the one driving port (ADR-002: only ever invoked by an
 * authenticated human submitting a form — the injection invariant, rail §7). Each
 * validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC:
 *   • quote_commodity_price — "C" + differential × the convert_qty lb/kg factor,
 *     snapshots COGS, enforces the margin floor, inserts regime='commodity'.
 *   • quote_reserve_price   — score×scarcity×comp build-up (optional human override),
 *     NEVER touches the "C" index, inserts regime='reserve'.
 *   • accept_quote          — inserts a lot_reservations row; the EXISTING
 *     prevent_oversell trigger fires there (no parallel counter); oversell ⇒ the
 *     whole transaction rolls back. This is the money-shaped, human-confirmed write.
 *
 * The regime-isolation keystone, the margin floor, and the oversell guard all live
 * in the database; these actions surface the author-written guard messages verbatim
 * (they are family-readable) and map structural Postgres errors to clean copy —
 * never a raw SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1) and
 * passed through so an exactly-once retry collapses to the same row.
 *
 * REVALIDATION: a SAVED quote (status 'quoted') moves NO consumer-route read — the
 * price board is indicative price + ATP, and ATP only changes on ACCEPT — so the
 * quote actions intentionally bust nothing. ACCEPT commits a lot_reservations row
 * (green inventory / ATP moves), so it fans out through reactiveRefresh, the RIPPLE
 * SSOT (never a hand-rolled revalidatePath — the ripple-actions-wired guard).
 *
 * WIRING SEAM (out of this slice's file scope — src/lib/revalidate.ts is a shared
 * contract file a parallel sibling /hedge also edits, so it is single-author in the
 * Wiring pass): accept currently rides the existing "inventory-update" kind (ATP is
 * green inventory). Wiring should add dedicated "price-accepted"/"price-quoted"/
 * "fixation-locked" EventKinds whose RIPPLE routes include /pricing + /hedge, register
 * pricing/actions.ts in the guard's KIND_TO_ACTION_FILES, and repoint these calls.
 */

export interface CommodityQuoteInput {
  greenLotCode: string;
  kg: number;
  contractMonth: string;
  differentialUsdPerLb: number;
  currency: string;
  fxRate: number;
  idempotencyKey: string;
}

export interface ReserveQuoteInput {
  greenLotCode: string;
  kg: number;
  /** null ⇒ take the modeled price; a value is still floored by the DB. */
  overrideUsdPerKg: number | null;
  currency: string;
  fxRate: number;
  idempotencyKey: string;
}

export interface AcceptQuoteInput {
  quoteId: number;
  buyer: string;
  idempotencyKey: string;
}

export type QuoteResult =
  | { ok: true; quoteId: number }
  | { ok: false; error: string };

export type AcceptResult =
  | { ok: true; reservationId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (regime isolation, margin floor,
 * oversell, status guards, "no C mark") — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception
    case "P0002": // no_data_found (e.g. "no ICE C mark for contract month")
    case "23503": // foreign_key_violation ("unknown green lot / quote")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to price this lot.";
    case "23505": // unique_violation — idempotent replay collided
      return "That quote was already saved.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export async function quoteCommodityPriceAction(
  input: CommodityQuoteInput,
): Promise<QuoteResult> {
  const t = await getTranslations("pricing");
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("errors.kgPositive") };
  }
  if (!input.contractMonth?.trim()) {
    return { ok: false, error: t("errors.contractRequired") };
  }
  if (!input.currency?.trim()) {
    return { ok: false, error: t("errors.currencyRequired") };
  }
  if (!isPositive(input.fxRate)) {
    return { ok: false, error: t("errors.fxPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("quote_commodity_price", {
    p_green_lot_code: input.greenLotCode,
    p_kg: input.kg,
    p_contract_month: input.contractMonth.trim(),
    p_differential_usd_per_lb: input.differentialUsdPerLb,
    p_currency: input.currency.trim(),
    p_fx_rate: input.fxRate,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // A 'quoted'-status row changes no consumer route's read; nothing to bust.
  return { ok: true, quoteId: Number(data) };
}

export async function quoteReservePriceAction(
  input: ReserveQuoteInput,
): Promise<QuoteResult> {
  const t = await getTranslations("pricing");
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("errors.kgPositive") };
  }
  if (!input.currency?.trim()) {
    return { ok: false, error: t("errors.currencyRequired") };
  }
  if (!isPositive(input.fxRate)) {
    return { ok: false, error: t("errors.fxPositive") };
  }
  if (
    input.overrideUsdPerKg != null &&
    !(Number.isFinite(input.overrideUsdPerKg) && input.overrideUsdPerKg > 0)
  ) {
    return { ok: false, error: t("errors.generic") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("quote_reserve_price", {
    p_green_lot_code: input.greenLotCode,
    p_kg: input.kg,
    p_override_usd_per_kg: input.overrideUsdPerKg,
    p_currency: input.currency.trim(),
    p_fx_rate: input.fxRate,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // A 'quoted'-status row changes no consumer route's read; nothing to bust.
  return { ok: true, quoteId: Number(data) };
}

export async function acceptQuoteAction(
  input: AcceptQuoteInput,
): Promise<AcceptResult> {
  const t = await getTranslations("pricing");
  if (!Number.isInteger(input.quoteId) || input.quoteId <= 0) {
    return { ok: false, error: t("errors.quoteRequired") };
  }
  if (!input.buyer?.trim()) {
    return { ok: false, error: t("errors.buyerRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("accept_quote", {
    p_quote_id: input.quoteId,
    p_buyer: input.buyer.trim(),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // accept_quote inserted a lot_reservations row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, reservationId: Number(data) };
}
