"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";
import type { PricingRegime } from "./data";

/**
 * /sales/offers WRITE port — the publish-offer Server Action (P3-S1).
 *
 * One driving port (ADR-002: only ever invoked by an authenticated human submitting a
 * form — the injection invariant, rail §7). It validates the shape the DB enforces
 * BEFORE the network hop, then appends through the single SECURITY DEFINER RPC
 * `publish_green_offer`, which fires the `_green_offers_regime_chk` trigger (a
 * Presidential/Specialty single-origin lot can NEVER be offered on the commodity
 * index) and appends an `'offer_published'` lot_event.
 *
 * REVALIDATION: publishing an offer does NOT commit green inventory (no
 * lot_reservations / lot_shipments row — an offer is a published intent, not a claim),
 * so ATP does not move and no cross-route ripple fires. The board re-reads on the next
 * navigation (the whole (app) is force-dynamic); the client island refreshes in place.
 */

export interface PublishOfferInput {
  greenLotCode: string;
  regime: PricingRegime;
  /** null ⇒ auction / RFQ (no fixed ask). */
  askingPrice: number | null;
  /** null ⇒ offer the whole available quantity. */
  kg: number | null;
  currency: string;
  idempotencyKey: string;
}

export type PublishOfferResult =
  | { ok: true; offerId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (regime isolation, unknown lot) — all
 * safe and clear, so they pass through verbatim. Structural codes get canned guidance;
 * nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written regime guard
    case "P0001": // raise_exception
    case "23503": // foreign_key_violation — unknown green lot
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to publish this offer.";
    case "23505": // unique_violation — idempotent replay collided
      return "That offer was already published.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export async function publishOfferAction(
  input: PublishOfferInput,
): Promise<PublishOfferResult> {
  const t = await getTranslations("sales");
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("offers.errors.lotRequired") };
  }
  if (input.askingPrice != null && !isPositive(input.askingPrice)) {
    return { ok: false, error: t("offers.errors.askingPositive") };
  }
  if (input.kg != null && !isPositive(input.kg)) {
    return { ok: false, error: t("offers.errors.kgPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("publish_green_offer", {
    p_green_lot_code: input.greenLotCode.trim(),
    p_regime: input.regime,
    p_asking_price: input.askingPrice,
    p_kg: input.kg,
    p_currency: input.currency?.trim() || "USD",
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("offers.errors.generic")),
    };
  }

  return { ok: true, offerId: Number(data) };
}
