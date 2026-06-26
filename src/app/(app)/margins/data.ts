import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /margins read port (P3-S16 accounting spine — the books' loop-closer).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S16 migration shipped — the `v_lot_margin` view (revenue_entry ⨝
 * mv_lot_cost_secure → realized $/kg-green margin) and the canonical `fx_rate` rate
 * book — rather than the sibling `@/lib/db/accounting` port. Two reasons, identical
 * to the /pricing precedent: (1) a parallel fan-out builds that port in a sibling
 * file, and importing a not-yet-existent module hard-fails Vite's import analysis at
 * BOTH test and build time; (2) the only load-bearing contract here is the
 * view/column names, which are frozen. The Wiring pass can collapse this into
 * `@/lib/db/accounting` (one import swap) once that port lands.
 *
 * READ-ONLY. The single write door is `record_fx_rate` in `actions.ts`. The realized
 * margin reads `mv_lot_cost_secure.cost_per_kg_green` through `v_lot_margin`; a lot
 * with NO cost on the books returns NULL margin (flagged, NEVER a fabricated floor —
 * rail §5). Numerics that PostgREST serializes as strings are coerced via `n()`, and
 * NULL is PRESERVED, never coalesced to 0.
 */

/** One lot's realized margin line (mirrors `v_lot_margin`, enriched with variety). */
export interface LotMargin {
  greenLotCode: string;
  variety: string | null;
  /** Σ revenue_entry.amount_usd for the lot. */
  revenueUsd: number | null;
  greenKg: number | null;
  totalCost: number | null;
  /** the COGS floor; NULL ⇒ cost not booked ⇒ margin stays blank. */
  costPerKgGreen: number | null;
  revenuePerKgGreen: number | null;
  /** THE loop-closer: realized $/kg-green. NULL when cost is not booked. */
  marginPerKgGreen: number | null;
  marginUsd: number | null;
}

/** One row of the canonical FX rate book (mirrors `fx_rate`). */
export interface FxRate {
  id: number;
  asOfDate: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
}

interface LotMarginViewRow {
  green_lot_code: string;
  revenue_usd: number | string | null;
  green_kg: number | string | null;
  total_cost: number | string | null;
  cost_per_kg_green: number | string | null;
  revenue_per_kg_green: number | string | null;
  margin_per_kg_green: number | string | null;
  margin_usd: number | string | null;
}

interface FxRateRow {
  id: number | string;
  as_of_date: string;
  base: string;
  quote: string;
  rate: number | string;
  source: string;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * The realized-margin board: every lot that has earned revenue, joined to its true
 * cost-per-kg-green. Margin is NULL whenever the cost half is absent — the page
 * renders that as "cost pending", never a fabricated number.
 */
export const getLotMargins = cache(async (): Promise<LotMargin[]> => {
  const sb = await getSupabase();
  const [margin, lots] = await Promise.all([
    sb.from("v_lot_margin").select("*").order("green_lot_code"),
    sb.from("lots").select("code, variety"),
  ]);

  if (margin.error) throw new Error(`getLotMargins: ${margin.error.message}`);
  if (lots.error) throw new Error(`getLotMargins(variety): ${lots.error.message}`);

  const varietyByCode = new Map<string, string | null>(
    (lots.data as { code: string; variety: string | null }[]).map((l) => [
      l.code,
      l.variety,
    ]),
  );

  return (margin.data as LotMarginViewRow[]).map((r) => ({
    greenLotCode: r.green_lot_code,
    variety: varietyByCode.get(r.green_lot_code) ?? null,
    revenueUsd: n(r.revenue_usd),
    greenKg: n(r.green_kg),
    totalCost: n(r.total_cost),
    costPerKgGreen: n(r.cost_per_kg_green),
    revenuePerKgGreen: n(r.revenue_per_kg_green),
    marginPerKgGreen: n(r.margin_per_kg_green),
    marginUsd: n(r.margin_usd),
  }));
});

/**
 * The canonical FX rate book — one place a rate lives (rail §6). Most recent first;
 * a USD-only farm shows an empty book, which is correct, not an error.
 */
export const getFxRates = cache(async (): Promise<FxRate[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("fx_rate")
    .select("id, as_of_date, base, quote, rate, source")
    .order("as_of_date", { ascending: false })
    .limit(30);

  if (error) throw new Error(`getFxRates: ${error.message}`);

  return (data as FxRateRow[]).map((r) => ({
    id: Number(r.id),
    asOfDate: r.as_of_date,
    base: r.base,
    quote: r.quote,
    rate: Number(r.rate),
    source: r.source,
  }));
});
