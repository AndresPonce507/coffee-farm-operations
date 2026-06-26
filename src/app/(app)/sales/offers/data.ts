import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/offers read port (P3-S1 B2B trade trunk).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S1 migration shipped — the `v_offer_board` view (live offers ⨝
 * green_lots grade/score ⨝ green_lots_atp) and, for the publish picker, the P3-S0
 * `v_lot_price_book` (every green lot's regime + remaining ATP). It does NOT import
 * the sibling `@/lib/db/b2b` port: a parallel fan-out builds that file, and importing
 * a not-yet-existent module hard-fails Vite's import-analysis at test + build time.
 * The Wiring pass can collapse this into the shared port (one import swap) later.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`.
 */

export type PricingRegime = "commodity" | "reserve";

/** One live published offer (mirrors `v_offer_board`, enriched with the lot variety). */
export interface OfferRow {
  offerId: number;
  greenLotCode: string;
  regime: PricingRegime;
  /** NULL ⇒ an auction / RFQ offer (no fixed ask). */
  askingPrice: number | null;
  /** NULL ⇒ the whole available quantity is offered. */
  offeredKg: number | null;
  currency: string;
  scaGrade: string | null;
  cuppingScore: number | null;
  atpKg: number | null;
  variety: string | null;
}

/** A green lot that can be offered (mirrors `v_lot_price_book`, the publish picker). */
export interface OfferableLot {
  greenLotCode: string;
  regime: PricingRegime;
  scaGrade: string | null;
  cuppingScore: number | null;
  atpKg: number | null;
}

interface OfferBoardViewRow {
  offer_id: number;
  green_lot_code: string;
  regime: string;
  asking_price: number | string | null;
  offered_kg: number | string | null;
  currency: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
  atp_kg: number | string | null;
}

interface PriceBookViewRow {
  green_lot_code: string;
  regime: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
  atp_kg: number | string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

const asRegime = (v: string): PricingRegime =>
  v === "reserve" ? "reserve" : "commodity";

/** Every live offer on the board, regime-resolved, with live ATP. */
export const getOfferBoard = cache(async (): Promise<OfferRow[]> => {
  const sb = await getSupabase();
  const [board, lots] = await Promise.all([
    sb.from("v_offer_board").select("*").order("green_lot_code"),
    sb.from("lots").select("code, variety"),
  ]);

  if (board.error) throw new Error(`getOfferBoard: ${board.error.message}`);
  if (lots.error) throw new Error(`getOfferBoard(variety): ${lots.error.message}`);

  const varietyByCode = new Map<string, string | null>(
    (lots.data as { code: string; variety: string | null }[]).map((l) => [
      l.code,
      l.variety,
    ]),
  );

  return (board.data as OfferBoardViewRow[]).map((r) => ({
    offerId: r.offer_id,
    greenLotCode: r.green_lot_code,
    regime: asRegime(r.regime),
    askingPrice: n(r.asking_price),
    offeredKg: n(r.offered_kg),
    currency: r.currency,
    scaGrade: r.sca_grade,
    cuppingScore: n(r.cupping_score),
    atpKg: n(r.atp_kg),
    variety: varietyByCode.get(r.green_lot_code) ?? null,
  }));
});

/**
 * The green lots that can be published as an offer — the publish picker's source.
 * Carries each lot's regime (so the form can NEVER let a Reserve lot be offered on
 * the commodity index — the keystone, mirrored from the DB trigger) and its live ATP.
 */
export const getOfferableLots = cache(async (): Promise<OfferableLot[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_lot_price_book")
    .select("green_lot_code, regime, sca_grade, cupping_score, atp_kg")
    .order("green_lot_code");
  if (error) throw new Error(`getOfferableLots: ${error.message}`);

  return (data as PriceBookViewRow[]).map((r) => ({
    greenLotCode: r.green_lot_code,
    regime: asRegime(r.regime),
    scaGrade: r.sca_grade,
    cuppingScore: n(r.cupping_score),
    atpKg: n(r.atp_kg),
  }));
});
