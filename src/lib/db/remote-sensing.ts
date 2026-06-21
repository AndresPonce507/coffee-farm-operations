import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CoffeeVariety,
  IpmThresholdStatus,
  PlotPhiStatus,
  PlotVegetation,
  SprayLogEntry,
  VegetationConfidence,
} from "@/lib/types";

/* ====================================================================== */
/* P2-S12 — Remote-sensing / IPM read-port (ADR-003 derived-read).        */
/* Four derived views power the /satellite + /scouting surfaces:           */
/*   • v_plot_vegetation  — every plot's fused NDVI/SAR read + the HONEST   */
/*     confidence badge (cloud is never hidden; SAR carries optical-stale). */
/*   • v_ipm_threshold    — the latest scouting read per (plot,pest) + the  */
/*     recommend/hold call from the economic-threshold engine.             */
/*   • v_plot_phi_status  — the active PHI/REI window per plot (the chips +  */
/*     the harvest-block).                                                  */
/*   • v_spray_history    — the append-only spray log per plot.            */
/* This module only READS. The sole write paths are the command RPCs        */
/* (record_vegetation_index / record_scouting / log_spray). Mirrors the     */
/* planning.ts / eudr.ts shape: Row iface + pure map + cache().             */
/* ====================================================================== */

const numOrNull = (v: number | string | null): number | null =>
  v === null ? null : Number(v);

/** A `v_plot_vegetation` row as PostgREST returns it (snake_case). */
export interface PlotVegetationRow {
  plot_id: string;
  plot_name: string;
  variety: CoffeeVariety;
  altitude_masl: number | string;
  value: number | string | null;
  index_kind: string | null;
  confidence: VegetationConfidence;
  basis: "optical" | "sar";
  cloud_pct: number | string | null;
  observed_at: string | null;
}

/** A `v_ipm_threshold` row as PostgREST returns it (snake_case). */
export interface IpmThresholdRow {
  plot_id: string;
  plot_name: string;
  pest_kind: string;
  incidence_pct: number | string;
  threshold: number | string | null;
  recommend: boolean;
  observed_at: string;
  fired_task_id: string | null;
}

/** A `v_plot_phi_status` row as PostgREST returns it (snake_case). */
export interface PlotPhiStatusRow {
  plot_id: string;
  plot_name: string;
  product: string;
  active_ingredient: string | null;
  applied_at: string;
  phi_clears_on: string;
  rei_clears_at: string;
  phi_active: boolean;
  rei_active: boolean;
}

/** A `v_spray_history` row as PostgREST returns it (snake_case). */
export interface SprayLogRow {
  id: number;
  plot_id: string;
  plot_name: string;
  product: string;
  active_ingredient: string | null;
  phi_days: number | string;
  rei_hours: number | string;
  applied_at: string;
  worker_id: string;
  worker_name: string;
}

/** Pure row → domain mapper for a plot's fused vegetation read. */
export function mapPlotVegetation(r: PlotVegetationRow): PlotVegetation {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    variety: r.variety,
    altitudeMasl: Number(r.altitude_masl),
    value: numOrNull(r.value),
    indexKind: r.index_kind,
    confidence: r.confidence,
    basis: r.basis,
    cloudPct: numOrNull(r.cloud_pct),
    observedAt: r.observed_at,
  };
}

/** Pure row → domain mapper for an IPM threshold status. */
export function mapIpmThreshold(r: IpmThresholdRow): IpmThresholdStatus {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    pestKind: r.pest_kind,
    incidencePct: Number(r.incidence_pct),
    threshold: numOrNull(r.threshold),
    recommend: r.recommend,
    observedAt: r.observed_at,
    firedTaskId: r.fired_task_id,
  };
}

/** Pure row → domain mapper for a plot's PHI/REI status. */
export function mapPlotPhiStatus(r: PlotPhiStatusRow): PlotPhiStatus {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    product: r.product,
    activeIngredient: r.active_ingredient,
    appliedAt: r.applied_at,
    phiClearsOn: r.phi_clears_on,
    reiClearsAt: r.rei_clears_at,
    phiActive: r.phi_active,
    reiActive: r.rei_active,
  };
}

/** Pure row → domain mapper for a spray-log entry. */
export function mapSprayLogEntry(r: SprayLogRow): SprayLogEntry {
  return {
    id: Number(r.id),
    plotId: r.plot_id,
    plotName: r.plot_name,
    product: r.product,
    activeIngredient: r.active_ingredient,
    phiDays: Number(r.phi_days),
    reiHours: Number(r.rei_hours),
    appliedAt: r.applied_at,
    workerId: r.worker_id,
    workerName: r.worker_name,
  };
}

/**
 * Every plot's fused vegetation read with its HONEST confidence badge, ordered so
 * the plots we can see clearly (high confidence) sit beside those we honestly
 * cannot (low) — the cloud is surfaced, never hidden. Ordered by plot name.
 */
export const getPlotVegetation = cache(async (): Promise<PlotVegetation[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_plot_vegetation")
    .select("*")
    .order("plot_name", { ascending: true });
  if (error) throw new Error(`getPlotVegetation: ${error.message}`);
  return (data as PlotVegetationRow[]).map(mapPlotVegetation);
});

/**
 * The latest IPM scouting threshold status per (plot, pest), recommend-first so the
 * plots needing a control intervention surface at the top of the scouting board.
 */
export const getIpmThresholds = cache(async (): Promise<IpmThresholdStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_ipm_threshold")
    .select("*")
    .order("recommend", { ascending: false })
    .order("incidence_pct", { ascending: false });
  if (error) throw new Error(`getIpmThresholds: ${error.message}`);
  return (data as IpmThresholdRow[]).map(mapIpmThreshold);
});

/** The active PHI/REI window per plot — the countdown chips + the harvest block. */
export const getPlotPhiStatus = cache(async (): Promise<PlotPhiStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_plot_phi_status")
    .select("*")
    .order("phi_clears_on", { ascending: false });
  if (error) throw new Error(`getPlotPhiStatus: ${error.message}`);
  return (data as PlotPhiStatusRow[]).map(mapPlotPhiStatus);
});

/** The append-only spray log, most-recent first — the history surface. */
export const getSprayHistory = cache(async (): Promise<SprayLogEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_spray_history")
    .select("*")
    .order("applied_at", { ascending: false });
  if (error) throw new Error(`getSprayHistory: ${error.message}`);
  return (data as SprayLogRow[]).map(mapSprayLogEntry);
});
