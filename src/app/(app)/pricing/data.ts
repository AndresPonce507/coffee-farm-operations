import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /pricing read port (P3-S0 dual-regime pricing core).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative
 * SQL surface the P3-S0 migration shipped — the `v_lot_price_book` /
 * `v_ice_c_latest` views, the `ice_c_quotes` / `auction_comps` /
 * `reserve_price_model` ledgers, and `farm_season_config` — rather than to the
 * sibling `@/lib/db/pricing` port. Two reasons: (1) a parallel fan-out builds that
 * port in a sibling file, and importing a not-yet-existent module hard-fails Vite's
 * import-analysis at BOTH test and build time; (2) the only contract that is
 * load-bearing here is the view/column/RPC names, which are frozen. The Wiring pass
 * can collapse this into `@/lib/db/pricing` (one import swap) once that port lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`.
 * The lb↔kg factor for the commodity "C" math is read from `convert_qty` — NEVER a
 * hardcoded 2.2046 (the named silent-corruption trap, rail §6).
 */

export type PricingRegime = "commodity" | "reserve";

/** A reserve "price story" row: the nearest public auction comp on file. */
export interface AuctionComp {
  auctionName: string;
  lotLabel: string | null;
  variety: string | null;
  process: string | null;
  cupScore: number | null;
  priceUsdPerKg: number;
  resultYear: number | null;
}

/** One green lot's price-book line (mirrors `v_lot_price_book`, enriched). */
export interface PriceBookRow {
  greenLotCode: string;
  variety: string | null;
  scaGrade: string | null;
  cuppingScore: number | null;
  regime: PricingRegime;
  /** cost-per-kg-green floor; NULL ⇒ COGS not booked ("margin unknown"). */
  cogsPerKgGreen: number | null;
  atpKg: number | null;
  indicativeUnitPrice: number | null;
  /** Reserve lots carry their nearest auction comp; commodity lots carry none. */
  nearestComp: AuctionComp | null;
}

interface PriceBookViewRow {
  green_lot_code: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
  regime: string;
  cogs_per_kg_green: number | string | null;
  atp_kg: number | string | null;
  indicative_unit_price: number | string | null;
}

interface AuctionCompRow {
  auction_name: string;
  lot_label: string | null;
  variety: string | null;
  process: string | null;
  cup_score: number | string | null;
  price_usd_per_kg: number | string;
  result_year: number | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

function mapComp(r: AuctionCompRow): AuctionComp {
  return {
    auctionName: r.auction_name,
    lotLabel: r.lot_label,
    variety: r.variety,
    process: r.process,
    cupScore: n(r.cup_score),
    priceUsdPerKg: Number(r.price_usd_per_kg),
    resultYear: r.result_year,
  };
}

/** Nearest comp to a target cup score; ties to the highest-priced anchor when the
 *  lot is uncupped or no comp carries a score (the BoP anchor is the price story). */
export function nearestComp(
  comps: AuctionComp[],
  score: number | null,
): AuctionComp | null {
  if (comps.length === 0) return null;
  if (score == null) {
    return comps.reduce((a, b) => (b.priceUsdPerKg > a.priceUsdPerKg ? b : a));
  }
  return comps.reduce((best, c) => {
    const dBest = best.cupScore == null ? Infinity : Math.abs(best.cupScore - score);
    const dC = c.cupScore == null ? Infinity : Math.abs(c.cupScore - score);
    return dC < dBest ? c : best;
  });
}

/**
 * The price book: every green lot, regime-resolved, with its live indicative
 * price, COGS floor, remaining ATP, and (for reserve lots) the nearest auction
 * comp as the price story.
 */
export const getPriceBook = cache(async (): Promise<PriceBookRow[]> => {
  const sb = await getSupabase();
  const [book, lots, comps] = await Promise.all([
    sb.from("v_lot_price_book").select("*").order("green_lot_code"),
    sb.from("lots").select("code, variety"),
    sb
      .from("auction_comps")
      .select(
        "auction_name, lot_label, variety, process, cup_score, price_usd_per_kg, result_year",
      ),
  ]);

  if (book.error) throw new Error(`getPriceBook: ${book.error.message}`);
  if (lots.error) throw new Error(`getPriceBook(variety): ${lots.error.message}`);
  if (comps.error) throw new Error(`getPriceBook(comps): ${comps.error.message}`);

  const varietyByCode = new Map<string, string | null>(
    (lots.data as { code: string; variety: string | null }[]).map((l) => [
      l.code,
      l.variety,
    ]),
  );
  const allComps = (comps.data as AuctionCompRow[]).map(mapComp);

  return (book.data as PriceBookViewRow[]).map((r) => {
    const regime: PricingRegime = r.regime === "reserve" ? "reserve" : "commodity";
    const cuppingScore = n(r.cupping_score);
    return {
      greenLotCode: r.green_lot_code,
      variety: varietyByCode.get(r.green_lot_code) ?? null,
      scaGrade: r.sca_grade,
      cuppingScore,
      regime,
      cogsPerKgGreen: n(r.cogs_per_kg_green),
      atpKg: n(r.atp_kg),
      indicativeUnitPrice: n(r.indicative_unit_price),
      // The C is the commodity price story; the comp library is the reserve one.
      nearestComp: regime === "reserve" ? nearestComp(allComps, cuppingScore) : null,
    };
  });
});

/* ───────────────────────── per-lot composer payload ───────────────────────── */

export interface CMark {
  contractMonth: string;
  price: number;
  asOf: string;
  source: string;
}

export interface ReserveModel {
  baseUsdPerKg: number;
  coefficientUsdPerPoint: number;
  scorePivot: number;
  scarcityUsdPerKg: number;
  version: number;
}

/** Everything the regime-aware quote composer needs for one green lot. */
export interface LotPricing {
  row: PriceBookRow;
  /** Recent ICE "C" marks (chronological) for the commodity sparkline. */
  cMarks: CMark[];
  latestContractMonth: string | null;
  latestCPrice: number | null;
  defaultDifferentialUsdPerLb: number;
  /** lb per kg, read from convert_qty (NEVER hardcoded). NULL if the unit is absent. */
  lbPerKg: number | null;
  reserveModel: ReserveModel | null;
  comps: AuctionComp[];
  commodityMinMarginPct: number;
  reserveMinMarginPct: number;
  settlementCurrency: string;
}

interface IceCRow {
  contract_month: string;
  price: number | string;
  as_of: string;
  source: string;
}

interface ReserveModelRow {
  base_usd_per_kg: number | string;
  coefficient_usd_per_point: number | string;
  score_pivot: number | string;
  scarcity_usd_per_kg: number | string;
  version: number | string;
}

interface SeasonConfigRow {
  settlement_currency: string | null;
  default_commodity_differential_usd_per_lb: number | string | null;
  commodity_min_margin_pct: number | string | null;
  reserve_min_margin_pct: number | string | null;
}

/**
 * The composer payload for one green lot. Returns null when no price-book row
 * exists for the code (the page 404s — never a fabricated lot). Soft reads degrade
 * gracefully: a missing C mark / reserve model / comp leaves its field empty, it
 * never throws (the route still renders the other regime's story + the floor).
 */
export const getLotPricing = cache(
  async (code: string): Promise<LotPricing | null> => {
    const sb = await getSupabase();

    const { data: bookRow, error: bookErr } = await sb
      .from("v_lot_price_book")
      .select("*")
      .eq("green_lot_code", code)
      .maybeSingle();
    if (bookErr) throw new Error(`getLotPricing: ${bookErr.message}`);
    if (!bookRow) return null;

    const view = bookRow as PriceBookViewRow;
    const regime: PricingRegime =
      view.regime === "reserve" ? "reserve" : "commodity";
    const cuppingScore = n(view.cupping_score);

    const [varietyRes, marksRes, latestRes, modelRes, compsRes, cfgRes, factorRes] =
      await Promise.all([
        sb.from("lots").select("variety").eq("code", code).maybeSingle(),
        sb
          .from("ice_c_quotes")
          .select("contract_month, price, as_of, source")
          .order("as_of", { ascending: true })
          .limit(60),
        sb
          .from("v_ice_c_latest")
          .select("contract_month, price, as_of")
          .order("as_of", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("reserve_price_model")
          .select(
            "base_usd_per_kg, coefficient_usd_per_point, score_pivot, scarcity_usd_per_kg, version",
          )
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("auction_comps")
          .select(
            "auction_name, lot_label, variety, process, cup_score, price_usd_per_kg, result_year",
          ),
        sb
          .from("farm_season_config")
          .select(
            "settlement_currency, default_commodity_differential_usd_per_lb, commodity_min_margin_pct, reserve_min_margin_pct",
          )
          .limit(1)
          .maybeSingle(),
        // lb per kg — the canonical conversion door (rail §6). NEVER a 2.2046 const.
        sb.rpc("convert_qty", { qty: 1, from_unit: "kg", to_unit: "[lb]" }),
      ]);

    const variety =
      (varietyRes.data as { variety: string | null } | null)?.variety ?? null;
    const cMarks: CMark[] = ((marksRes.data as IceCRow[] | null) ?? []).map((m) => ({
      contractMonth: m.contract_month,
      price: Number(m.price),
      asOf: m.as_of,
      source: m.source,
    }));
    const latest = latestRes.data as
      | { contract_month: string; price: number | string }
      | null;
    const modelRow = modelRes.data as ReserveModelRow | null;
    const cfg = cfgRes.data as SeasonConfigRow | null;
    const comps = ((compsRes.data as AuctionCompRow[] | null) ?? []).map(mapComp);

    const row: PriceBookRow = {
      greenLotCode: view.green_lot_code,
      variety,
      scaGrade: view.sca_grade,
      cuppingScore,
      regime,
      cogsPerKgGreen: n(view.cogs_per_kg_green),
      atpKg: n(view.atp_kg),
      indicativeUnitPrice: n(view.indicative_unit_price),
      nearestComp:
        regime === "reserve" ? nearestComp(comps, cuppingScore) : null,
    };

    return {
      row,
      cMarks,
      latestContractMonth: latest?.contract_month ?? null,
      latestCPrice: latest == null ? null : Number(latest.price),
      defaultDifferentialUsdPerLb: Number(
        cfg?.default_commodity_differential_usd_per_lb ?? 0.35,
      ),
      lbPerKg: factorRes.error || factorRes.data == null ? null : Number(factorRes.data),
      reserveModel: modelRow
        ? {
            baseUsdPerKg: Number(modelRow.base_usd_per_kg),
            coefficientUsdPerPoint: Number(modelRow.coefficient_usd_per_point),
            scorePivot: Number(modelRow.score_pivot),
            scarcityUsdPerKg: Number(modelRow.scarcity_usd_per_kg),
            version: Number(modelRow.version),
          }
        : null,
      comps,
      commodityMinMarginPct: Number(cfg?.commodity_min_margin_pct ?? 0.1),
      reserveMinMarginPct: Number(cfg?.reserve_min_margin_pct ?? 0.2),
      settlementCurrency: cfg?.settlement_currency ?? "USD",
    };
  },
);
