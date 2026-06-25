import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S4 — Specialty auctions READ-port (ADR-003 derived-read). The         */
/* highest-multiplier green-sale channel: Best of Panama / Cup of Excellence */
/* / Algrano / private auctions. A green lot is ENTERED into an auction      */
/* (the entry inserts a `lot_reservations` row keyed buyer='AUCTION:<name>', */
/* so the EXISTING prevent_oversell trigger guards it — an auction-committed  */
/* lot can never be double-sold via a B2B contract), JUDGED (append-only     */
/* `auction_scoresheets`, aggregated by `v_auction_final_score`), and CLEARED */
/* (the win writes back to P3-S0 as a fresh reserve comp). The headline read  */
/* is `v_auction_results`: the clearing price AND the price-multiplier over    */
/* the farm's commodity baseline — the BoP premium made visible. The only      */
/* writers are the SECURITY DEFINER RPCs in the command ports                  */
/* (`@/lib/db/commands/{createAuction,enterAuctionLot,recordAuctionScoresheet, */
/* recordAuctionResult}`). This port only READS. Mirrors the pricing.ts /       */
/* greenlots.ts shape: `Row` interface + pure `mapX` mapper + `cache()`'d       */
/* getters; NULLs (un-scored jury / un-cleared lot / no live commodity          */
/* baseline) are PRESERVED, never fabricated to 0 — the UI shows "—".            */
/* ====================================================================== */

/** The `auction_platform` enum — the four channels a lot can be entered into. */
export type AuctionPlatform =
  | "best_of_panama"
  | "cup_of_excellence"
  | "algrano"
  | "private";

/** An auction's lifecycle status: entered → scored → live → sold → withdrawn. */
export type AuctionStatus =
  | "entered"
  | "scored"
  | "live"
  | "sold"
  | "withdrawn";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-scored jury / un-cleared price / missing commodity
 *  baseline stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- auctions ---------------- */

/** Shape of an `auctions` header row as returned by PostgREST (snake_case). */
export interface AuctionRow {
  id: number;
  platform: AuctionPlatform | string;
  name: string;
  entry_deadline: string | null;
  scoring_deadline: string | null;
  status: AuctionStatus | string;
  created_at: string;
}

/** An auction header — the platform, name, deadlines and lifecycle status. */
export interface Auction {
  id: number;
  platform: AuctionPlatform | string;
  name: string;
  entryDeadline: string | null;
  scoringDeadline: string | null;
  status: AuctionStatus | string;
  createdAt: string;
}

/** Pure row → domain mapper for an auction header (null deadlines preserved). */
export function mapAuction(r: AuctionRow): Auction {
  return {
    id: Number(r.id),
    platform: r.platform,
    name: r.name,
    entryDeadline: r.entry_deadline,
    scoringDeadline: r.scoring_deadline,
    status: r.status,
    createdAt: r.created_at,
  };
}

/* ---------------- v_auction_results ---------------- */

/** Shape of a `v_auction_results` row (snake_case). The score/price/baseline/
 *  multiplier columns are NULL until the lot is judged/cleared and a live "C"
 *  mark exists to derive the commodity baseline. */
export interface AuctionResultRow {
  entry_id: number;
  auction_id: number;
  auction_name: string;
  platform: AuctionPlatform | string;
  auction_status: AuctionStatus | string;
  green_lot_code: string;
  farm_cupping_score: number | string | null;
  jury_score: number | string | null;
  panel_final_score: number | string | null;
  clearing_price_usd_per_kg: number | string | null;
  winning_bidder: string | null;
  result_year: number | null;
  commodity_baseline_usd_per_kg: number | string | null;
  price_multiplier: number | string | null;
}

/** One auction entry's reconciled result: the farm's own cup score, the panel's
 *  jury verdict, the clearing price, and the price-multiplier over the commodity
 *  baseline (the BoP premium made visible). NULLs preserved end-to-end. */
export interface AuctionResult {
  entryId: number;
  auctionId: number;
  auctionName: string;
  platform: AuctionPlatform | string;
  auctionStatus: AuctionStatus | string;
  greenLotCode: string;
  /** The farm's own grade INPUT (`green_lots.cupping_score`). NULL when un-cupped. */
  farmCuppingScore: number | null;
  /** The auction panel's headline verdict (`auction_entries.jury_score`). */
  juryScore: number | null;
  /** The aggregated scoresheet average (`v_auction_final_score.final_score`). */
  panelFinalScore: number | null;
  clearingPriceUsdPerKg: number | null;
  winningBidder: string | null;
  resultYear: number | null;
  /** Latest "C" + the house default differential, $/lb→$/kg via convert_qty. NULL ⇒ no live mark. */
  commodityBaselineUsdPerKg: number | null;
  /** clearing ÷ baseline — NULL when either is null/zero (never a fabricated multiple). */
  priceMultiplier: number | null;
}

/** Pure row → domain mapper for an auction result (numeric coercion; every
 *  score/price/baseline/multiplier NULL preserved, never fabricated to 0). */
export function mapAuctionResult(r: AuctionResultRow): AuctionResult {
  return {
    entryId: Number(r.entry_id),
    auctionId: Number(r.auction_id),
    auctionName: r.auction_name,
    platform: r.platform,
    auctionStatus: r.auction_status,
    greenLotCode: r.green_lot_code,
    farmCuppingScore: num(r.farm_cupping_score),
    juryScore: num(r.jury_score),
    panelFinalScore: num(r.panel_final_score),
    clearingPriceUsdPerKg: num(r.clearing_price_usd_per_kg),
    winningBidder: r.winning_bidder,
    resultYear: r.result_year == null ? null : Number(r.result_year),
    commodityBaselineUsdPerKg: num(r.commodity_baseline_usd_per_kg),
    priceMultiplier: num(r.price_multiplier),
  };
}

/* ---------------- v_auction_final_score ---------------- */

/** Shape of a `v_auction_final_score` row (the aggregated jury panel per entry). */
export interface AuctionFinalScoreRow {
  entry_id: number;
  auction_id: number;
  green_lot_code: string;
  final_score: number | string | null;
  juror_count: number | string;
  mark_count: number | string;
}

/** The aggregated jury panel for one entry: the average mark + the panel size. */
export interface AuctionFinalScore {
  entryId: number;
  auctionId: number;
  greenLotCode: string;
  /** avg(score) across all marks — NULL when no marks exist yet. */
  finalScore: number | null;
  jurorCount: number;
  markCount: number;
}

/** Pure row → domain mapper for the aggregated panel score (numeric coercion;
 *  NULL final score preserved when an entry has no marks yet). */
export function mapAuctionFinalScore(r: AuctionFinalScoreRow): AuctionFinalScore {
  return {
    entryId: Number(r.entry_id),
    auctionId: Number(r.auction_id),
    greenLotCode: r.green_lot_code,
    finalScore: num(r.final_score),
    jurorCount: Number(r.juror_count),
    markCount: Number(r.mark_count),
  };
}

/* ---------------- auction_scoresheets ---------------- */

/** Shape of an `auction_scoresheets` row (the append-only per-juror/attribute mark). */
export interface AuctionScoresheetRow {
  id: number;
  entry_id: number;
  juror: string;
  attribute: string;
  score: number | string;
  occurred_at: string;
  created_at: string;
}

/** One append-only jury mark: a juror's score for a single CVA attribute. */
export interface AuctionScoresheet {
  id: number;
  entryId: number;
  juror: string;
  attribute: string;
  score: number;
  occurredAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a jury mark (numeric coercion of the score). */
export function mapAuctionScoresheet(r: AuctionScoresheetRow): AuctionScoresheet {
  return {
    id: Number(r.id),
    entryId: Number(r.entry_id),
    juror: r.juror,
    attribute: r.attribute,
    score: Number(r.score),
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/* ---------------- auction_entries ---------------- */

/** Shape of an `auction_entries` row (snake_case). The result columns
 *  (jury_score/clearing/winner/year/sold_at) are NULL until the lot clears. */
export interface AuctionEntryRow {
  id: number;
  auction_id: number;
  green_lot_code: string;
  kg: number | string;
  jury_score: number | string | null;
  clearing_price_usd_per_kg: number | string | null;
  winning_bidder: string | null;
  result_year: number | null;
  reservation_id: number | null;
  sold_at: string | null;
  created_at: string;
}

/** One lot entered into an auction. `reservationId` is the AUCTION claim that
 *  prevent_oversell guards; the result fields fill in once the lot clears. */
export interface AuctionEntry {
  id: number;
  auctionId: number;
  greenLotCode: string;
  kg: number;
  juryScore: number | null;
  clearingPriceUsdPerKg: number | null;
  winningBidder: string | null;
  resultYear: number | null;
  reservationId: number | null;
  soldAt: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for an auction entry (numeric coercion; NULL result
 *  fields on an un-cleared entry preserved, never fabricated). */
export function mapAuctionEntry(r: AuctionEntryRow): AuctionEntry {
  return {
    id: Number(r.id),
    auctionId: Number(r.auction_id),
    greenLotCode: r.green_lot_code,
    kg: Number(r.kg),
    juryScore: num(r.jury_score),
    clearingPriceUsdPerKg: num(r.clearing_price_usd_per_kg),
    winningBidder: r.winning_bidder,
    resultYear: r.result_year == null ? null : Number(r.result_year),
    reservationId: r.reservation_id == null ? null : Number(r.reservation_id),
    soldAt: r.sold_at,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Every auction header (`auctions`), newest first — the `/sales/auctions` board.
 * Status walks entered → scored → live → sold → withdrawn; the win write-back
 * flips it to 'sold'.
 */
export const getAuctions = cache(async (): Promise<Auction[]> => {
  const { data, error } = await (await getSupabase())
    .from("auctions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getAuctions: ${error.message}`);
  return (data as AuctionRow[]).map(mapAuction);
});

/**
 * One auction header (`auctions` filtered to the id), or `null` when the id has
 * no row yet (notFound() territory for the `/sales/auctions/[id]` detail page).
 */
export const getAuction = cache(
  async (id: number): Promise<Auction | null> => {
    const { data, error } = await (await getSupabase())
      .from("auctions")
      .select("*")
      .eq("id", id);
    if (error) throw new Error(`getAuction: ${error.message}`);
    const rows = (data as AuctionRow[] | null) ?? [];
    return rows.length > 0 ? mapAuction(rows[0]) : null;
  },
);

/**
 * Every auction entry's reconciled result (`v_auction_results`) — farm score vs
 * jury verdict vs panel average, clearing price, and the price-multiplier over the
 * commodity baseline. The BoP-premium board.
 */
export const getAuctionResults = cache(async (): Promise<AuctionResult[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_auction_results")
    .select("*")
    .order("entry_id");
  if (error) throw new Error(`getAuctionResults: ${error.message}`);
  return (data as AuctionResultRow[]).map(mapAuctionResult);
});

/**
 * The reconciled results for ONE auction (`v_auction_results` filtered to the
 * auction id) — the `/sales/auctions/[id]` results cards.
 */
export const getAuctionResultsFor = cache(
  async (auctionId: number): Promise<AuctionResult[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_auction_results")
      .select("*")
      .eq("auction_id", auctionId)
      .order("entry_id");
    if (error) throw new Error(`getAuctionResultsFor: ${error.message}`);
    return (data as AuctionResultRow[]).map(mapAuctionResult);
  },
);

/**
 * The lots entered into ONE auction (`auction_entries` filtered to the auction
 * id), oldest first — the entry list on the detail page. `reservationId` is the
 * AUCTION claim that prevent_oversell guards.
 */
export const getAuctionEntries = cache(
  async (auctionId: number): Promise<AuctionEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("auction_entries")
      .select("*")
      .eq("auction_id", auctionId)
      .order("created_at");
    if (error) throw new Error(`getAuctionEntries: ${error.message}`);
    return (data as AuctionEntryRow[]).map(mapAuctionEntry);
  },
);

/**
 * The append-only jury marks for ONE entry (`auction_scoresheets` filtered to the
 * entry id), in capture order — the scoresheet history behind the panel average.
 */
export const getAuctionScoresheets = cache(
  async (entryId: number): Promise<AuctionScoresheet[]> => {
    const { data, error } = await (await getSupabase())
      .from("auction_scoresheets")
      .select("*")
      .eq("entry_id", entryId)
      .order("occurred_at");
    if (error) throw new Error(`getAuctionScoresheets: ${error.message}`);
    return (data as AuctionScoresheetRow[]).map(mapAuctionScoresheet);
  },
);

/**
 * The aggregated jury panel for ONE entry (`v_auction_final_score` filtered to the
 * entry id), or `null` when no marks exist yet — the panel average + size for the
 * radial scoresheet UI.
 */
export const getAuctionFinalScore = cache(
  async (entryId: number): Promise<AuctionFinalScore | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_auction_final_score")
      .select("*")
      .eq("entry_id", entryId);
    if (error) throw new Error(`getAuctionFinalScore: ${error.message}`);
    const rows = (data as AuctionFinalScoreRow[] | null) ?? [];
    return rows.length > 0 ? mapAuctionFinalScore(rows[0]) : null;
  },
);
