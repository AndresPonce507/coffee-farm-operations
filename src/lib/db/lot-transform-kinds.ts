import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S6 — Lot-graph prereq: mill/roast/byproduct edge-kinds + the milling/  */
/* roasting domain enums + the yield-curve reference read-port.             */
/*                                                                          */
/* S6 is a PURE SCHEMA prereq — it introduces NO new table, view, or RPC:   */
/* it widens the `lot_edges.kind` CHECK to admit the three transform edge-   */
/* kinds ('mill'/'roast'/'byproduct'), extends/adds the milling+roasting     */
/* domain enums, and seeds real parchment→green / green→roasted factors into */
/* the existing `lot_yield_curve` reference table. So this port has NO       */
/* command twin (there is no SECURITY DEFINER RPC to wrap — the runs that    */
/* post against these kinds/enums land in S7..S10). It is the typed          */
/* VOCABULARY the downstream slices' forms/UI declare against PLUS the one    */
/* read surface S6 touches: the `lot_yield_curve` reference table.           */
/*                                                                          */
/* Every constant below is bound VERBATIM to the on-disk migration           */
/* `20260705090000_lot_edges_mill_roast_kinds.sql` (the same exact label      */
/* sets the slice's PGlite test pins against `pg_enum`). Mirrors the          */
/* pricing.ts / gradable-lots.ts read-port idiom: `as const` vocabularies +   */
/* type guards + a pure `mapX` mapper + `cache()`'d getters; an absent        */
/* yield-curve row stays `null` (never a fabricated factor).                  */
/* ====================================================================== */

/* ---------------- lot_edges.kind — the widened CHECK ---------------- */

/**
 * The full `lot_edges.kind` vocabulary after S6 widened the CHECK, in CHECK
 * order. Verbatim from `lot_edges_kind_check check (kind in (...))`. The
 * kind-agnostic `lot_edges_conserve_mass()` trigger guards every kind — the
 * money/mass guarantee is reused, never re-implemented per kind.
 */
export const LOT_EDGE_KINDS = [
  "split",
  "merge",
  "blend",
  "process",
  "mill",
  "roast",
  "byproduct",
] as const;
export type LotEdgeKind = (typeof LOT_EDGE_KINDS)[number];

/**
 * The three transform edge-kinds S6 adds — a mill output, a roast batch, and a
 * byproduct stream are each a mass-conserved `lot_edges` child of this kind.
 */
export const TRANSFORM_EDGE_KINDS = ["mill", "roast", "byproduct"] as const;
export type TransformEdgeKind = (typeof TRANSFORM_EDGE_KINDS)[number];

/** Is `v` a recognised `lot_edges.kind` (the post-S6 superset CHECK)? */
export function isLotEdgeKind(v: string): v is LotEdgeKind {
  return (LOT_EDGE_KINDS as readonly string[]).includes(v);
}

/** Is `v` one of the three transform edge-kinds S6 admits? */
export function isTransformEdgeKind(v: string): v is TransformEdgeKind {
  return (TRANSFORM_EDGE_KINDS as readonly string[]).includes(v);
}

/* ---------------- milling/roasting domain enums ---------------- */

/** The `pass_type` enum — the ordered dry-mill machine chain (S7/S8). */
export const PASS_TYPES = [
  "huller",
  "polisher",
  "screen_grader",
  "gravity_table",
  "optical_sorter",
] as const;
export type PassType = (typeof PASS_TYPES)[number];

/** The `roast_level` enum — the golden-profile roast band (S10). */
export const ROAST_LEVELS = [
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/** The `roaster_type` enum — the roaster registry kind (S10). */
export const ROASTER_TYPES = ["drum", "fluid_bed", "sample"] as const;
export type RoasterType = (typeof ROASTER_TYPES)[number];

/**
 * The `roast_profile_status` enum — the versioned golden-profile lifecycle (S10).
 * NOTE: the on-disk enum is draft/approved/retired (NOT the 'golden' label that
 * appears in the spec prose) — bound to disk so a form can never submit a label
 * Postgres rejects.
 */
export const ROAST_PROFILE_STATUSES = [
  "draft",
  "approved",
  "retired",
] as const;
export type RoastProfileStatus = (typeof ROAST_PROFILE_STATUSES)[number];

/**
 * The `byproduct_kind` enum — the sellable mill byproduct streams (S8).
 * NOTE: the on-disk enum is husk/chaff/screen_rejects/defects (NOT the
 * 'cascara'/'pasilla' labels in the spec prose) — bound to disk.
 */
export const BYPRODUCT_KINDS = [
  "husk",
  "chaff",
  "screen_rejects",
  "defects",
] as const;
export type ByproductKind = (typeof BYPRODUCT_KINDS)[number];

/** Is `v` a recognised `pass_type`? */
export function isPassType(v: string): v is PassType {
  return (PASS_TYPES as readonly string[]).includes(v);
}

/** Is `v` a recognised `roast_level`? */
export function isRoastLevel(v: string): v is RoastLevel {
  return (ROAST_LEVELS as readonly string[]).includes(v);
}

/** Is `v` a recognised `roaster_type`? */
export function isRoasterType(v: string): v is RoasterType {
  return (ROASTER_TYPES as readonly string[]).includes(v);
}

/** Is `v` a recognised `roast_profile_status`? */
export function isRoastProfileStatus(v: string): v is RoastProfileStatus {
  return (ROAST_PROFILE_STATUSES as readonly string[]).includes(v);
}

/** Is `v` a recognised `byproduct_kind`? */
export function isByproductKind(v: string): v is ByproductKind {
  return (BYPRODUCT_KINDS as readonly string[]).includes(v);
}

/* ---------------- lot_yield_curve (the reference read-port) ---------------- */

/**
 * Shape of a `lot_yield_curve` row as returned by PostgREST (snake_case).
 * `yield_factor` is `numeric` (the CHECK guarantees `0 < factor <= 1`) and may be
 * serialized as a string. S6 seeds the real transform factors: parchment→green
 * (dry-mill outturn ~0.80) and green→roasted (roast shrinkage ~0.84).
 */
export interface LotYieldCurveRow {
  from_stage: string;
  to_stage: string;
  yield_factor: number | string;
}

/** A house yield-loss factor for one stage transition (domain, camelCase). */
export interface LotYieldFactor {
  fromStage: string;
  toStage: string;
  /** Mass-retained fraction across the transition (0 < factor <= 1). */
  yieldFactor: number;
}

/** Pure row → domain mapper for a yield-curve factor (numeric coercion). */
export function mapYieldFactor(r: LotYieldCurveRow): LotYieldFactor {
  return {
    fromStage: r.from_stage,
    toStage: r.to_stage,
    yieldFactor: Number(r.yield_factor),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The full house yield curve (`lot_yield_curve`) — every stage transition's
 * mass-retained factor, ordered for a stable read. The reference table is global
 * (RLS-free, `grant select to authenticated`); S6 seeded the dry-mill and roast
 * transform factors the conservation `≈` carries.
 */
export const getLotYieldCurve = cache(async (): Promise<LotYieldFactor[]> => {
  const { data, error } = await (await getSupabase())
    .from("lot_yield_curve")
    .select("*")
    .order("from_stage")
    .order("to_stage");
  if (error) throw new Error(`getLotYieldCurve: ${error.message}`);
  return (data as LotYieldCurveRow[]).map(mapYieldFactor);
});

/**
 * The yield factor for one stage transition (e.g. `('parchment','green')` → the
 * dry-mill outturn), or `null` when the curve has no row for that pair. NULL is
 * preserved — a missing factor is never fabricated to 0 or 1. Backed by the
 * `cache()`'d full-curve read (one fetch per request; the lookup is in JS, so no
 * stage text is interpolated into a PostgREST filter).
 */
export const getYieldFactor = cache(
  async (fromStage: string, toStage: string): Promise<number | null> => {
    const curve = await getLotYieldCurve();
    const hit = curve.find(
      (f) => f.fromStage === fromStage && f.toStage === toStage,
    );
    return hit ? hit.yieldFactor : null;
  },
);
