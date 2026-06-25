import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S0 — Dual-regime pricing READ-port (ADR-003 derived-read). The       */
/* price-resolution core every commerce slice reads. A green lot is priced  */
/* on ONE of two regimes — 'commodity' (ICE "C" + differential) or          */
/* 'reserve' (auction-comp-clamped model) — chosen by price_regime_for_lot  */
/* and surfaced through the `v_lot_price_book` view. The append-only market  */
/* ledgers (`ice_c_quotes`, `auction_comps`) are the provenance behind every */
/* figure; the only writers are the SECURITY DEFINER RPCs in the command     */
/* ports (`@/lib/db/commands/*`). This port only READS. Mirrors the          */
/* greenlots.ts / cogs.ts shape: `Row` interface + pure `mapX` mapper +      */
/* `cache()`'d getters; NULLs (unknown COGS / no live mark) are PRESERVED,   */
/* never fabricated to 0 — the UI shows "—" instead of a misleading number.  */
/* ====================================================================== */

/** A green lot's pricing regime: index-priced or reserve-priced. */
export type PricingRegime = "commodity" | "reserve";

/** Where an ICE "C" mark came from — feed-agnostic; 'manual' is the $0 fallback. */
export type IceCSource = "manual" | "barchart-free" | "investing-scrape";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an unknown COGS / missing indicative price / no live mark
 *  stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_lot_price_book ---------------- */

/** Shape of a `v_lot_price_book` row as returned by PostgREST (snake_case).
 *  `cogs_per_kg_green` / `atp_kg` / `indicative_unit_price` are best-effort and
 *  may be NULL (no COGS booked / no green inventory / no live regime inputs). */
export interface LotPriceBookRow {
  green_lot_code: string;
  sca_grade: string;
  cupping_score: number | string;
  regime: PricingRegime | string;
  cogs_per_kg_green: number | string | null;
  atp_kg: number | string | null;
  indicative_unit_price: number | string | null;
}

/** Per green lot: its regime, live indicative price, COGS floor, indicative
 *  margin inputs and remaining ATP. The RPCs are the authoritative pricers — the
 *  indicative price is a best-effort preview (NULL when the regime's inputs are
 *  missing). */
export interface LotPriceBookEntry {
  greenLotCode: string;
  scaGrade: string;
  cuppingScore: number;
  regime: PricingRegime | string;
  /** Cost-per-kg-green snapshot from cogs_per_lot/mv_lot_cost. NULL ⇒ margin unknown. */
  cogsPerKgGreen: number | null;
  /** Available-to-promise (kg). NULL when the lot has no green inventory yet. */
  atpKg: number | null;
  /** Best-effort live unit price ($/kg). NULL when the regime's inputs are missing. */
  indicativeUnitPrice: number | null;
}

/** Pure row → domain mapper for a price-book entry (numeric coercion; NULL
 *  cogs/atp/indicative price preserved, never fabricated to 0). */
export function mapPriceBookEntry(r: LotPriceBookRow): LotPriceBookEntry {
  return {
    greenLotCode: r.green_lot_code,
    scaGrade: r.sca_grade,
    cuppingScore: Number(r.cupping_score),
    regime: r.regime,
    cogsPerKgGreen: num(r.cogs_per_kg_green),
    atpKg: num(r.atp_kg),
    indicativeUnitPrice: num(r.indicative_unit_price),
  };
}

/* ---------------- v_ice_c_latest ---------------- */

/** Shape of a `v_ice_c_latest` row (the latest "C" mark per contract month). */
export interface IceCLatestRow {
  contract_month: string;
  price: number | string;
  as_of: string;
  source: IceCSource | string;
}

/** The latest ICE "C" mark for a contract month (USD per lb). */
export interface IceCLatest {
  contractMonth: string;
  price: number;
  asOf: string;
  source: IceCSource | string;
}

/** Pure row → domain mapper for the latest "C" mark (numeric coercion of price). */
export function mapIceCLatest(r: IceCLatestRow): IceCLatest {
  return {
    contractMonth: r.contract_month,
    price: Number(r.price),
    asOf: r.as_of,
    source: r.source,
  };
}

/* ---------------- v_fixation_exposure ---------------- */

/** Shape of a `v_fixation_exposure` row (snake_case). `current_c_price` /
 *  `exposure_usd` are NULL when no live mark exists for the contract month.
 *  `price_quote_id` is OPTIONAL: it is present only once the view's SELECT adds
 *  `pq.id as price_quote_id` (see the seam note on `priceQuoteId` below). */
export interface FixationExposureRow {
  green_lot_code: string;
  reservation_id: number;
  kg: number | string;
  ice_c_contract_month: string;
  current_c_price: number | string | null;
  exposure_usd: number | string | null;
  price_quote_id?: number | string | null;
}

/** Open commodity reservation not yet fixed × current "C" = the unfixed price
 *  risk for one accepted commodity quote. */
export interface FixationExposure {
  greenLotCode: string;
  reservationId: number;
  kg: number;
  iceCContractMonth: string;
  currentCPrice: number | null;
  exposureUsd: number | null;
  /**
   * `price_quotes.id` — the argument `lock_fixation(p_quote_id)` / the `lockFixation`
   * command key off. CROSS-SLICE SEAM (flagged by the /hedge cockpit author): the
   * `v_fixation_exposure` view currently exposes only `reservation_id`, so this is
   * NULL until the migration adds `pq.id as price_quote_id` to that view's SELECT.
   * Surfaced here so the cockpit binds to it and the lock affordance lights up the
   * moment the view provides it — until then it stays NULL and the cockpit disables
   * the lock (never fires `lock_fixation` with a wrong id). `reservation_id` is 1:1
   * with the accepted, un-fixed commodity quote, so the join is unambiguous.
   */
  priceQuoteId: number | null;
}

/** Pure row → domain mapper for an exposure row (numeric coercion; NULL live
 *  mark / exposure preserved; `priceQuoteId` NULL until the view provides it). */
export function mapFixationExposure(r: FixationExposureRow): FixationExposure {
  return {
    greenLotCode: r.green_lot_code,
    reservationId: Number(r.reservation_id),
    kg: Number(r.kg),
    iceCContractMonth: r.ice_c_contract_month,
    currentCPrice: num(r.current_c_price),
    exposureUsd: num(r.exposure_usd),
    priceQuoteId: num(r.price_quote_id),
  };
}

/* ---------------- auction_comps ---------------- */

/** Shape of an `auction_comps` row (snake_case) for display. */
export interface AuctionCompRow {
  id: number;
  auction_name: string;
  lot_label: string | null;
  variety: string | null;
  process: string | null;
  cup_score: number | string | null;
  price_usd_per_kg: number | string;
  result_year: number | null;
  created_at: string;
}

/** A reserve comp from the public BoP/CoE library — the reserve price story. */
export interface AuctionComp {
  id: number;
  auctionName: string;
  lotLabel: string | null;
  variety: string | null;
  process: string | null;
  cupScore: number | null;
  priceUsdPerKg: number;
  resultYear: number | null;
  createdAt: string;
}

/** Pure row → domain mapper for a comp (numeric coercion of score/price; null
 *  label/variety/process/score/year passthrough). */
export function mapAuctionComp(r: AuctionCompRow): AuctionComp {
  return {
    id: Number(r.id),
    auctionName: r.auction_name,
    lotLabel: r.lot_label,
    variety: r.variety,
    process: r.process,
    cupScore: num(r.cup_score),
    priceUsdPerKg: Number(r.price_usd_per_kg),
    resultYear: r.result_year == null ? null : Number(r.result_year),
    createdAt: r.created_at,
  };
}

/* ---------------- ice_c_quotes (the append-only ledger) ---------------- */

/** Shape of an `ice_c_quotes` ledger row (snake_case) for display/history. */
export interface IceCQuoteRow {
  id: number;
  contract_month: string;
  as_of: string;
  price: number | string;
  source: IceCSource | string;
  created_at: string;
}

/** One posted ICE "C" mark in the append-only ledger (USD per lb). */
export interface IceCQuote {
  id: number;
  contractMonth: string;
  asOf: string;
  price: number;
  source: IceCSource | string;
  createdAt: string;
}

/** Pure row → domain mapper for a posted "C" mark (numeric coercion of price). */
export function mapIceCQuote(r: IceCQuoteRow): IceCQuote {
  return {
    id: Number(r.id),
    contractMonth: r.contract_month,
    asOf: r.as_of,
    price: Number(r.price),
    source: r.source,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The full price book — every green lot's regime, live indicative price, COGS
 * floor and remaining ATP (`v_lot_price_book`). The regime is decided in the DB
 * (`price_regime_for_lot`): a Presidential/Specialty single-origin lot is
 * 'reserve', everything else 'commodity'. The indicative price is best-effort
 * (NULL when the regime's inputs are missing); the command RPCs are authoritative.
 */
export const getPriceBook = cache(async (): Promise<LotPriceBookEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_lot_price_book")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`getPriceBook: ${error.message}`);
  return (data as LotPriceBookRow[]).map(mapPriceBookEntry);
});

/**
 * One green lot's price-book entry (`v_lot_price_book` filtered to the lot), or
 * `null` when the lot has no row yet (notFound() territory for the /pricing/[lot]
 * detail page). Same regime/indicative-price semantics as `getPriceBook`.
 */
export const getLotPricing = cache(
  async (lot: string): Promise<LotPriceBookEntry | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_lot_price_book")
      .select("*")
      .eq("green_lot_code", lot);
    if (error) throw new Error(`getLotPricing: ${error.message}`);
    const rows = (data as LotPriceBookRow[] | null) ?? [];
    return rows.length > 0 ? mapPriceBookEntry(rows[0]) : null;
  },
);

/**
 * Open, accepted-but-unfixed commodity reservations × the live "C" mark =
 * the unfixed price exposure (`v_fixation_exposure`). The /hedge surface's risk
 * board. `currentCPrice` / `exposureUsd` are NULL when no live mark exists yet.
 */
export const getFixationExposure = cache(
  async (): Promise<FixationExposure[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_fixation_exposure")
      .select("*")
      .order("green_lot_code");
    if (error) throw new Error(`getFixationExposure: ${error.message}`);
    return (data as FixationExposureRow[]).map(mapFixationExposure);
  },
);

/**
 * The latest ICE "C" mark per contract month (`v_ice_c_latest`) — the live index
 * the commodity pricer reads. Manual mark entry is the always-available $0
 * fallback; a free-tier scrape adapter drops in behind `record_ice_c_quote`.
 */
export const getIceCLatest = cache(async (): Promise<IceCLatest[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_ice_c_latest")
    .select("*")
    .order("contract_month");
  if (error) throw new Error(`getIceCLatest: ${error.message}`);
  return (data as IceCLatestRow[]).map(mapIceCLatest);
});

/**
 * The reserve auction-comp library (`auction_comps`), highest price first so the
 * $30,204/kg 2025 Best-of-Panama washed-Geisha anchor leads — the reserve price
 * story the model clamps to.
 */
export const getAuctionComps = cache(async (): Promise<AuctionComp[]> => {
  const { data, error } = await (await getSupabase())
    .from("auction_comps")
    .select("*")
    .order("price_usd_per_kg", { ascending: false });
  if (error) throw new Error(`getAuctionComps: ${error.message}`);
  return (data as AuctionCompRow[]).map(mapAuctionComp);
});

/**
 * The append-only ICE "C" mark ledger (`ice_c_quotes`), newest mark first — the
 * full posted history behind every commodity quote (the provenance + sparkline
 * source). Immutable: corrections are new marks, never edits.
 */
export const listIceCQuotes = cache(async (): Promise<IceCQuote[]> => {
  const { data, error } = await (await getSupabase())
    .from("ice_c_quotes")
    .select("*")
    .order("as_of", { ascending: false });
  if (error) throw new Error(`listIceCQuotes: ${error.message}`);
  return (data as IceCQuoteRow[]).map(mapIceCQuote);
});
