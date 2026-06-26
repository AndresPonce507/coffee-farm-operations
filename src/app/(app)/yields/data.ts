import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /yields read port (P3-S6 lot-graph prereq — mill/roast/byproduct edge-kinds +
 * yield-curve rows).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the one authoritative
 * surface this schema-prereq slice materialises — the `lot_yield_curve` reference
 * table the P3-S6 migration extended (the existing wet-process placeholders plus the
 * two new transform factors: parchment→green dry-mill outturn 0.80 and green→roasted
 * roast shrinkage 0.84). P3-S6 introduces NO new table, view, or RPC, so there is no
 * command port and no write door here — this surface is read-only by design (the
 * actual milling/roasting runs that POST mass land in P3-S7..S10).
 *
 * `lot_yield_curve` already carries `grant select … to authenticated` (the
 * event_log_units_lot_graph migration), and P3-S6 asserts that posture unchanged, so
 * a cookie-scoped `authenticated` read just works under RLS.
 */

export type YieldKind = "process" | "mill" | "roast";

/** One house yield factor (mirrors a `lot_yield_curve` row), enriched with a kind. */
export interface YieldStageRow {
  fromStage: string;
  toStage: string;
  /** 0 < factor ≤ 1 — the share of mass that survives the transform. */
  yieldFactor: number;
}

interface YieldCurveDbRow {
  from_stage: string;
  to_stage: string;
  yield_factor: number | string;
}

/**
 * The canonical processing order, cherry → roasted bag. Drives a stable board sort
 * (the table has no order column) and the whole-chain "cherry → green" survival math.
 */
export const STAGE_ORDER = [
  "cherry",
  "fermentation",
  "drying",
  "parchment",
  "milled",
  "green",
  "roasted",
] as const;

/** The canonical cherry → green path (used for the whole-chain survival KPI). */
export const CHERRY_TO_GREEN_PATH: ReadonlyArray<[string, string]> = [
  ["cherry", "fermentation"],
  ["fermentation", "drying"],
  ["drying", "parchment"],
  ["parchment", "green"],
];

function orderIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return i === -1 ? STAGE_ORDER.length : i;
}

/**
 * Classify a yield row into the lot-graph transform kind it represents — the same
 * vocabulary the P3-S6 `lot_edges.kind` CHECK now admits. `roasted` output is a
 * roast edge; a green/milled output (or a milled input) is a dry-mill edge; the wet
 * fermentation/drying steps are the upstream process.
 */
export function classifyYield(fromStage: string, toStage: string): YieldKind {
  if (toStage === "roasted") return "roast";
  if (toStage === "green" || toStage === "milled" || fromStage === "milled") {
    return "mill";
  }
  return "process";
}

const n = (v: number | string): number => Number(v);

/** Every house yield factor, ordered along the canonical processing chain. */
export const getYieldCurve = cache(async (): Promise<YieldStageRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("lot_yield_curve")
    .select("from_stage, to_stage, yield_factor");
  if (error) throw new Error(`getYieldCurve: ${error.message}`);

  return (data as YieldCurveDbRow[])
    .map((r) => ({
      fromStage: r.from_stage,
      toStage: r.to_stage,
      yieldFactor: n(r.yield_factor),
    }))
    .sort(
      (a, b) =>
        orderIndex(a.fromStage) - orderIndex(b.fromStage) ||
        orderIndex(a.toStage) - orderIndex(b.toStage),
    );
});

/** The direct factor for a transform, or null when that edge isn't on file. */
export function factorFor(
  rows: YieldStageRow[],
  fromStage: string,
  toStage: string,
): number | null {
  const hit = rows.find((r) => r.fromStage === fromStage && r.toStage === toStage);
  return hit ? hit.yieldFactor : null;
}

/**
 * Whole-chain cherry → green survival: the product of every step on the canonical
 * path. Returns null (never a fabricated number) if any step is missing — graceful
 * degradation, the same posture as a NULL COGS surfacing "unknown" not a guess.
 */
export function cherryToGreenFactor(rows: YieldStageRow[]): number | null {
  let acc = 1;
  for (const [from, to] of CHERRY_TO_GREEN_PATH) {
    const f = factorFor(rows, from, to);
    if (f == null) return null;
    acc *= f;
  }
  return acc;
}
