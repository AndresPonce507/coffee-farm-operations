import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/auctions read port (P3-S4 specialty auctions).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S4 migration shipped — the `auctions` header table, the
 * `v_auction_results` view (entries ⨝ panel score ⨝ clearing price ⨝ the multiplier
 * over the farm's commodity baseline), `v_auction_final_score` (jury panel
 * aggregate), and the green-inventory ATP view for the lot-entry picker — rather than
 * a sibling shared port a parallel fan-out is still authoring (importing a
 * not-yet-existent module hard-fails Vite's import-analysis at build AND test time).
 * The Wiring pass can collapse this into `@/lib/db/auctions` once that port lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`. The
 * commodity baseline (and therefore the price multiplier) is computed in the view via
 * `convert_qty` — NEVER a hardcoded 2.2046 (rail §6).
 */

export type AuctionPlatform =
  | "best_of_panama"
  | "cup_of_excellence"
  | "algrano"
  | "private";

export type AuctionStatus =
  | "entered"
  | "scored"
  | "live"
  | "sold"
  | "withdrawn";

/** The auction header (mirrors the `auctions` table, app-shaped). */
export interface AuctionHeader {
  id: number;
  platform: AuctionPlatform;
  name: string;
  status: AuctionStatus;
  entryDeadline: string | null;
  scoringDeadline: string | null;
}

/** One entry's result line (mirrors `v_auction_results`). */
export interface AuctionResultRow {
  entryId: number;
  auctionId: number;
  auctionName: string;
  platform: AuctionPlatform;
  auctionStatus: AuctionStatus;
  greenLotCode: string;
  /** the farm's OWN grade input — distinct from the jury's verdict. */
  farmCuppingScore: number | null;
  /** the auction panel's headline verdict. */
  juryScore: number | null;
  /** aggregated from the scoresheets (avg mark). */
  panelFinalScore: number | null;
  clearingPriceUsdPerKg: number | null;
  winningBidder: string | null;
  resultYear: number | null;
  commodityBaselineUsdPerKg: number | null;
  /** clearing ÷ baseline; NULL when either is missing (never fabricated). */
  priceMultiplier: number | null;
}

/** A board card: an auction header folded together with its entries' results. */
export interface AuctionSummary extends AuctionHeader {
  entryCount: number;
  soldCount: number;
  bestClearingPriceUsdPerKg: number | null;
  bestMultiplier: number | null;
}

/** A detail-page entry: the result row enriched with the jury-panel counts. */
export interface AuctionEntry extends Omit<AuctionResultRow, "auctionId" | "auctionName" | "platform" | "auctionStatus"> {
  kg: number;
  jurorCount: number;
  markCount: number;
  sold: boolean;
}

/** A green lot eligible for entry (has ATP left). */
export interface AvailableLot {
  greenLotCode: string;
  variety: string | null;
  cuppingScore: number | null;
  scaGrade: string | null;
  atpKg: number;
}

export interface AuctionDetail extends AuctionHeader {
  entries: AuctionEntry[];
  availableLots: AvailableLot[];
}

/* ─────────────────────────────── row shapes ──────────────────────────────── */

interface AuctionHeaderRow {
  id: number;
  platform: string;
  name: string;
  status: string;
  entry_deadline: string | null;
  scoring_deadline: string | null;
}

interface AuctionResultViewRow {
  entry_id: number;
  auction_id: number;
  auction_name: string;
  platform: string;
  auction_status: string;
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

interface FinalScoreViewRow {
  entry_id: number;
  juror_count: number | string | null;
  mark_count: number | string | null;
}

interface EntryKgRow {
  id: number;
  kg: number | string;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

const asPlatform = (v: string): AuctionPlatform =>
  v === "cup_of_excellence" || v === "algrano" || v === "private"
    ? v
    : "best_of_panama";

const asStatus = (v: string): AuctionStatus =>
  v === "scored" || v === "live" || v === "sold" || v === "withdrawn"
    ? v
    : "entered";

function mapHeader(r: AuctionHeaderRow): AuctionHeader {
  return {
    id: r.id,
    platform: asPlatform(r.platform),
    name: r.name,
    status: asStatus(r.status),
    entryDeadline: r.entry_deadline,
    scoringDeadline: r.scoring_deadline,
  };
}

function mapResult(r: AuctionResultViewRow): AuctionResultRow {
  return {
    entryId: r.entry_id,
    auctionId: r.auction_id,
    auctionName: r.auction_name,
    platform: asPlatform(r.platform),
    auctionStatus: asStatus(r.auction_status),
    greenLotCode: r.green_lot_code,
    farmCuppingScore: n(r.farm_cupping_score),
    juryScore: n(r.jury_score),
    panelFinalScore: n(r.panel_final_score),
    clearingPriceUsdPerKg: n(r.clearing_price_usd_per_kg),
    winningBidder: r.winning_bidder,
    resultYear: r.result_year,
    commodityBaselineUsdPerKg: n(r.commodity_baseline_usd_per_kg),
    priceMultiplier: n(r.price_multiplier),
  };
}

/* ────────────────────────────── pure folds ───────────────────────────────── */

/**
 * Fold the per-entry result rows up onto each auction header: entry count, sold
 * count (entries that actually cleared), and the best clearing price + best
 * multiplier across the round. Pure — every numeric input already coerced. NULLs are
 * ignored, never coerced to 0 (a missing clearing/multiplier is "pending", not zero).
 */
export function buildAuctionSummaries(
  headers: AuctionHeader[],
  results: AuctionResultRow[],
): AuctionSummary[] {
  const byAuction = new Map<number, AuctionResultRow[]>();
  for (const r of results) {
    const list = byAuction.get(r.auctionId);
    if (list) list.push(r);
    else byAuction.set(r.auctionId, [r]);
  }

  const bestOf = (
    rows: AuctionResultRow[],
    pick: (r: AuctionResultRow) => number | null,
  ): number | null =>
    rows.reduce<number | null>((best, r) => {
      const v = pick(r);
      return v != null && (best == null || v > best) ? v : best;
    }, null);

  return headers.map((h) => {
    const rows = byAuction.get(h.id) ?? [];
    return {
      ...h,
      entryCount: rows.length,
      soldCount: rows.filter((r) => r.clearingPriceUsdPerKg != null).length,
      bestClearingPriceUsdPerKg: bestOf(rows, (r) => r.clearingPriceUsdPerKg),
      bestMultiplier: bestOf(rows, (r) => r.priceMultiplier),
    };
  });
}

/* ──────────────────────────────── reads ──────────────────────────────────── */

/** The auction board: every auction with its entries folded into a summary. */
export const getAuctions = cache(async (): Promise<AuctionSummary[]> => {
  const sb = await getSupabase();
  const [headers, results] = await Promise.all([
    sb
      .from("auctions")
      .select("id, platform, name, status, entry_deadline, scoring_deadline")
      .order("created_at", { ascending: false }),
    sb.from("v_auction_results").select("*"),
  ]);

  if (headers.error) throw new Error(`getAuctions: ${headers.error.message}`);
  if (results.error) throw new Error(`getAuctions(results): ${results.error.message}`);

  return buildAuctionSummaries(
    (headers.data as AuctionHeaderRow[]).map(mapHeader),
    (results.data as AuctionResultViewRow[]).map(mapResult),
  );
});

/**
 * One auction's full workspace: the header, every entry (result + jury-panel
 * counts), and the green lots still eligible to enter (ATP > 0). Returns null when no
 * auction carries the id (the page 404s — never a fabricated auction).
 */
export const getAuctionDetail = cache(
  async (id: number): Promise<AuctionDetail | null> => {
    const sb = await getSupabase();

    const { data: headerRow, error: headerErr } = await sb
      .from("auctions")
      .select("id, platform, name, status, entry_deadline, scoring_deadline")
      .eq("id", id)
      .maybeSingle();
    if (headerErr) throw new Error(`getAuctionDetail: ${headerErr.message}`);
    if (!headerRow) return null;

    const [resultsRes, finalRes, entriesRes, atpRes, greenRes, lotsRes] =
      await Promise.all([
        sb.from("v_auction_results").select("*").eq("auction_id", id),
        sb
          .from("v_auction_final_score")
          .select("entry_id, juror_count, mark_count")
          .eq("auction_id", id),
        sb.from("auction_entries").select("id, kg").eq("auction_id", id),
        sb.from("green_lots_atp").select("green_lot_code, atp, sca_grade"),
        sb.from("green_lots").select("lot_code, cupping_score"),
        sb.from("lots").select("code, variety"),
      ]);

    if (resultsRes.error) throw new Error(`getAuctionDetail(results): ${resultsRes.error.message}`);
    if (finalRes.error) throw new Error(`getAuctionDetail(final): ${finalRes.error.message}`);
    if (entriesRes.error) throw new Error(`getAuctionDetail(entries): ${entriesRes.error.message}`);
    if (atpRes.error) throw new Error(`getAuctionDetail(atp): ${atpRes.error.message}`);
    if (greenRes.error) throw new Error(`getAuctionDetail(green): ${greenRes.error.message}`);
    if (lotsRes.error) throw new Error(`getAuctionDetail(lots): ${lotsRes.error.message}`);

    const finalByEntry = new Map<number, FinalScoreViewRow>(
      (finalRes.data as FinalScoreViewRow[]).map((f) => [f.entry_id, f]),
    );
    const kgByEntry = new Map<number, number>(
      (entriesRes.data as EntryKgRow[]).map((e) => [e.id, Number(e.kg)]),
    );

    const entries: AuctionEntry[] = (resultsRes.data as AuctionResultViewRow[])
      .map(mapResult)
      .map((r) => {
        const f = finalByEntry.get(r.entryId);
        return {
          entryId: r.entryId,
          greenLotCode: r.greenLotCode,
          kg: kgByEntry.get(r.entryId) ?? 0,
          farmCuppingScore: r.farmCuppingScore,
          juryScore: r.juryScore,
          panelFinalScore: r.panelFinalScore,
          clearingPriceUsdPerKg: r.clearingPriceUsdPerKg,
          winningBidder: r.winningBidder,
          resultYear: r.resultYear,
          commodityBaselineUsdPerKg: r.commodityBaselineUsdPerKg,
          priceMultiplier: r.priceMultiplier,
          jurorCount: Number(f?.juror_count ?? 0),
          markCount: Number(f?.mark_count ?? 0),
          sold: r.clearingPriceUsdPerKg != null,
        };
      })
      .sort((a, b) => a.entryId - b.entryId);

    const cupByCode = new Map<string, number | null>(
      (greenRes.data as { lot_code: string; cupping_score: number | string | null }[]).map(
        (g) => [g.lot_code, n(g.cupping_score)],
      ),
    );
    const varietyByCode = new Map<string, string | null>(
      (lotsRes.data as { code: string; variety: string | null }[]).map((l) => [
        l.code,
        l.variety,
      ]),
    );

    const availableLots: AvailableLot[] = (
      atpRes.data as { green_lot_code: string; atp: number | string; sca_grade: string | null }[]
    )
      .map((a) => ({
        greenLotCode: a.green_lot_code,
        variety: varietyByCode.get(a.green_lot_code) ?? null,
        cuppingScore: cupByCode.get(a.green_lot_code) ?? null,
        scaGrade: a.sca_grade,
        atpKg: Number(a.atp),
      }))
      .filter((a) => a.atpKg > 0)
      .sort((a, b) => a.greenLotCode.localeCompare(b.greenLotCode));

    return {
      ...mapHeader(headerRow as AuctionHeaderRow),
      entries,
      availableLots,
    };
  },
);
