import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  AllocationRule,
  CostDriver,
  CostEntry,
  CostTargetKind,
  LotCost,
  LotRuleCost,
} from "@/lib/types";

/* ====================================================================== */
/* S7 — Activity-based COGS read-port (ADR-003 derived-read; the one earned */
/* matview exception). The number the business turns on: true              */
/* cost-per-kg-green per lot/plot. The recursive walk DOWN the lot graph    */
/* apportioning each cost over green-kg lives in `mv_lot_cost` + the        */
/* cogs_per_lot()/cogs_per_plot() `security_invoker` RPCs (RLS-respecting); */
/* the append-only `cost_entry` ledger is the provenance behind every       */
/* figure (the future QBO/Xero journal source + audit trail). This port     */
/* only READS — the sole write paths are the append-only cost_entry INSERT  */
/* + the refresh_lot_cost() refresh (owned elsewhere this slice). Mirrors   */
/* the greenlots.ts / events.ts shape: `Row` interface + pure `mapX` +      */
/* `cache()`'d getters; scalar verdicts come back via `.rpc()`.            */
/* ====================================================================== */

/* ---------------- cost_entry provenance row ---------------- */

/** Shape of a `cost_entry` row as returned by PostgREST (snake_case).
 *  `amount_usd` is a numeric PostgREST may serialize as a string; a reversal is a
 *  negative-amount row whose `reverses_id` self-links to the original. A farm-wide
 *  overhead row carries a null `target_code`. */
export interface CostEntryRow {
  id: number;
  driver: CostDriver | string;
  allocation_rule: AllocationRule | string;
  target_kind: CostTargetKind | string;
  target_code: string | null;
  amount_usd: number | string;
  reverses_id: number | null;
  memo: string | null;
  occurred_at: string;
  created_at: string;
}

/** Pure row → domain mapper for a ledger row (snake_case → camelCase, numeric
 *  coercion of the signed amount; null target/reverses/memo pass through). */
export function mapCostEntry(r: CostEntryRow): CostEntry {
  return {
    id: r.id,
    driver: r.driver,
    allocationRule: r.allocation_rule,
    targetKind: r.target_kind,
    targetCode: r.target_code,
    amountUsd: Number(r.amount_usd),
    reversesId: r.reverses_id,
    memo: r.memo,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/** Coerce an RPC's numeric verdict to a number, preserving NULL (zero/undeclared
 *  green-kg → NULL from the RPC, never a fabricated 0 or a divide-by-zero). */
function toCostPerKg(value: unknown): number | null {
  return value == null ? null : Number(value);
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Cost-per-kg-green for one green lot via the `cogs_per_lot` RPC (security_invoker
 * — reads the matview under the caller's RLS). `costPerKgGreen` is NULL when the
 * lot's green-kg denominator is 0/undeclared (the RPC returns NULL, never a
 * divide-by-zero raise) — the UI shows "—" rather than a fabricated 0.
 */
export const getLotCost = cache(async (code: string): Promise<LotCost> => {
  const { data, error } = await (await getSupabase()).rpc("cogs_per_lot", {
    p_lot_code: code,
  });
  if (error) throw new Error(`getLotCost: ${error.message}`);
  return { code, costPerKgGreen: toCostPerKg(data) };
});

/**
 * Cost-per-kg-green for a plot via the `cogs_per_plot` RPC — Σcost / Σgreen-kg
 * across the green lots descended from the plot's harvested lots (resolved by the
 * RPC's seed/edge walk). NULL when the plot has no green-kg yet (no divide-by-zero).
 */
export const getPlotCost = cache(async (id: string): Promise<LotCost> => {
  const { data, error } = await (await getSupabase()).rpc("cogs_per_plot", {
    p_plot_id: id,
  });
  if (error) throw new Error(`getPlotCost: ${error.message}`);
  return { code: id, costPerKgGreen: toCostPerKg(data) };
});

/** A `cogs_breakdown_per_lot` RPC row (snake_case): one allocation rule's share
 *  of a green lot's fully-allocated cost. `allocated_cost` is a numeric PostgREST
 *  may serialize as a string. */
interface LotRuleCostRow {
  allocation_rule: AllocationRule | string;
  allocated_cost: number | string;
}

/**
 * The per-rule cost build-up behind a green lot's headline, via the
 * `cogs_breakdown_per_lot` RPC (security_invoker — reads the per-rule matview
 * under the caller's RLS). These rows are the SAME allocation the `cogs_per_lot`
 * headline divides — overhead pro-rata, agronomy plot-split, and costs walked
 * down from source lots are ALL included — so the card's waterfall/decomposition
 * reconcile to cost-per-kg-green exactly (Σ allocatedUsd / greenKg === headline).
 * Replaces feeding the card a lot-literal `cost_entry` ledger that silently
 * omitted those three and contradicted its own total (D-COST review CRIT).
 */
export const getCostBreakdownByRule = cache(
  async (code: string): Promise<LotRuleCost[]> => {
    const { data, error } = await (await getSupabase()).rpc(
      "cogs_breakdown_per_lot",
      { p_lot_code: code },
    );
    if (error) throw new Error(`getCostBreakdownByRule: ${error.message}`);
    return ((data as LotRuleCostRow[] | null) ?? []).map((r) => ({
      rule: r.allocation_rule,
      allocatedUsd: Number(r.allocated_cost),
    }));
  },
);

/**
 * The append-only `cost_entry` provenance ledger — the journal rows behind every
 * COGS figure (the future QBO/Xero source + audit trail). Ordered by `id` (the
 * append sequence) so originals precede their reversing entries. Optionally scoped
 * to one allocation target so a lot/plot drawer shows only its own provenance;
 * reversals are KEPT (append-only) and net the original by summing signed amounts.
 */
export const getCostBreakdown = cache(
  async (scope?: {
    targetKind: CostTargetKind | string;
    targetCode: string;
  }): Promise<CostEntry[]> => {
    // Filter (`.eq`) BEFORE transform (`.order`): supabase-js's
    // PostgrestTransformBuilder (what `.order()` returns) has no filter methods.
    let filtered = (await getSupabase()).from("cost_entry").select("*");
    if (scope) {
      filtered = filtered
        .eq("target_kind", scope.targetKind)
        .eq("target_code", scope.targetCode);
    }
    const { data, error } = await filtered.order("id", { ascending: true });
    if (error) throw new Error(`getCostBreakdown: ${error.message}`);
    return (data as CostEntryRow[]).map(mapCostEntry);
  },
);
