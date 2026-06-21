import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { ProcessMethod } from "@/lib/types";

/* ====================================================================== */
/* P2-S3 — Fermentation & wet-mill tracker read-port (ADR-003 derived-read). */
/* The make-quality slice: a versioned altitude-tuned recipe library, ferment */
/* batches bound to a lot_code + recipe version, a live pH/temp/Brix reading   */
/* series, a predicted cut-point, and an eco-mill water-per-kg log. This port   */
/* only READS; the sole writers are the SECURITY DEFINER command RPCs           */
/* (start_ferment_batch / record_ferment_reading / log_mill_water). Mirrors the */
/* greenlots.ts / processing.ts shape. */
/* ====================================================================== */

export type FermentReadingKind = "ph" | "temp" | "brix";

/* ---------------- ferment_recipes ---------------- */

/** A `ferment_recipes` row as PostgREST returns it (snake_case; numerics may
 *  arrive as strings). */
export interface FermentRecipeRow {
  id: string;
  name: string;
  method: ProcessMethod | string;
  altitude_band: string;
  target_ph: number | string;
  target_temp_c: number | string;
  target_brix_drop: number | string;
  target_hours: number | string;
  version: number;
  superseded_by: string | null;
}

export interface FermentRecipe {
  id: string;
  name: string;
  method: ProcessMethod | string;
  altitudeBand: string;
  targetPh: number;
  targetTempC: number;
  targetBrixDrop: number;
  targetHours: number;
  version: number;
  supersededBy: string | null;
}

export function mapFermentRecipe(r: FermentRecipeRow): FermentRecipe {
  return {
    id: r.id,
    name: r.name,
    method: r.method,
    altitudeBand: r.altitude_band,
    targetPh: Number(r.target_ph),
    targetTempC: Number(r.target_temp_c),
    targetBrixDrop: Number(r.target_brix_drop),
    targetHours: Number(r.target_hours),
    version: Number(r.version),
    supersededBy: r.superseded_by,
  };
}

/* ---------------- ferment_batches ---------------- */

export interface FermentBatchRow {
  id: string;
  lot_code: string;
  recipe_id: string | null;
  method: ProcessMethod | string;
  started_at: string;
  ended_at: string | null;
}

export interface FermentBatch {
  id: string;
  lotCode: string;
  recipeId: string | null;
  method: ProcessMethod | string;
  startedAt: string;
  endedAt: string | null;
}

export function mapFermentBatch(r: FermentBatchRow): FermentBatch {
  return {
    id: r.id,
    lotCode: r.lot_code,
    recipeId: r.recipe_id,
    method: r.method,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

/* ---------------- v_ferment_curve ---------------- */

export interface FermentCurveRow {
  batch_id: string;
  lot_code: string;
  reading_kind: FermentReadingKind | string;
  value: number | string;
  occurred_at: string;
  hours_elapsed: number | string;
}

export interface FermentCurvePoint {
  batchId: string;
  lotCode: string;
  readingKind: FermentReadingKind | string;
  value: number;
  occurredAt: string;
  hoursElapsed: number;
}

export function mapFermentCurvePoint(r: FermentCurveRow): FermentCurvePoint {
  return {
    batchId: r.batch_id,
    lotCode: r.lot_code,
    readingKind: r.reading_kind,
    value: Number(r.value),
    occurredAt: r.occurred_at,
    hoursElapsed: Number(r.hours_elapsed),
  };
}

/* ---------------- v_ferment_cutpoint ---------------- */

export interface FermentCutpointRow {
  batch_id: string;
  lot_code: string;
  recipe_id: string | null;
  target_ph: number | string | null;
  target_hours: number | string | null;
  latest_ph: number | string | null;
  latest_at: string | null;
  hours_elapsed: number | string | null;
  cut_reached: boolean;
}

export interface FermentCutpoint {
  batchId: string;
  lotCode: string;
  recipeId: string | null;
  targetPh: number | null;
  targetHours: number | null;
  latestPh: number | null;
  latestAt: string | null;
  hoursElapsed: number | null;
  cutReached: boolean;
}

/** Coerce a numeric-or-null PostgREST field to `number | null` (null stays null). */
function numOrNull(v: number | string | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function mapFermentCutpoint(r: FermentCutpointRow): FermentCutpoint {
  return {
    batchId: r.batch_id,
    lotCode: r.lot_code,
    recipeId: r.recipe_id,
    targetPh: numOrNull(r.target_ph),
    targetHours: numOrNull(r.target_hours),
    latestPh: numOrNull(r.latest_ph),
    latestAt: r.latest_at,
    hoursElapsed: numOrNull(r.hours_elapsed),
    cutReached: r.cut_reached,
  };
}

/* ---------------- v_water_per_kg ---------------- */

export interface WaterPerKgRow {
  lot_code: string;
  lot_kg: number | string;
  total_liters: number | string;
  liters_per_kg: number | string | null;
}

export interface WaterPerKg {
  lotCode: string;
  lotKg: number;
  totalLiters: number;
  litersPerKg: number | null;
}

export function mapWaterPerKg(r: WaterPerKgRow): WaterPerKg {
  return {
    lotCode: r.lot_code,
    lotKg: Number(r.lot_kg),
    totalLiters: Number(r.total_liters),
    litersPerKg: numOrNull(r.liters_per_kg),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/** Every recipe (the versioned library — supersede chain included). */
export const getActiveRecipes = cache(async (): Promise<FermentRecipe[]> => {
  const { data, error } = await (await getSupabase())
    .from("ferment_recipes")
    .select("*")
    .order("name")
    .order("version", { ascending: false });
  if (error) throw new Error(`getActiveRecipes: ${error.message}`);
  return (data as FermentRecipeRow[]).map(mapFermentRecipe);
});

/** Every ferment batch (newest first). */
export const getFermentBatches = cache(async (): Promise<FermentBatch[]> => {
  const { data, error } = await (await getSupabase())
    .from("ferment_batches")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) throw new Error(`getFermentBatches: ${error.message}`);
  return (data as FermentBatchRow[]).map(mapFermentBatch);
});

/** The live reading series for one batch (chronological), from v_ferment_curve. */
export const getFermentCurve = cache(
  async (batchId: string): Promise<FermentCurvePoint[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_ferment_curve")
      .select("*")
      .eq("batch_id", batchId)
      .order("occurred_at");
    if (error) throw new Error(`getFermentCurve: ${error.message}`);
    return (data as FermentCurveRow[]).map(mapFermentCurvePoint);
  },
);

/** The predicted cut-point for one batch, or null when there is no row. */
export const getFermentCutpoint = cache(
  async (batchId: string): Promise<FermentCutpoint | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_ferment_cutpoint")
      .select("*")
      .eq("batch_id", batchId);
    if (error) throw new Error(`getFermentCutpoint: ${error.message}`);
    const rows = data as FermentCutpointRow[];
    return rows.length > 0 ? mapFermentCutpoint(rows[0]) : null;
  },
);

/** The eco-mill water-per-kg number for one lot, or null when there is no row. */
export const getWaterPerKg = cache(
  async (lotCode: string): Promise<WaterPerKg | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_water_per_kg")
      .select("*")
      .eq("lot_code", lotCode);
    if (error) throw new Error(`getWaterPerKg: ${error.message}`);
    const rows = data as WaterPerKgRow[];
    return rows.length > 0 ? mapWaterPerKg(rows[0]) : null;
  },
);
