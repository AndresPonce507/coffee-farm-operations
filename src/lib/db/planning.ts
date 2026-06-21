import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CoffeeVariety,
  PasadaPlan,
  PasadaStatus,
  PlotReadiness,
  ReadinessConfidence,
  RipenessTarget,
} from "@/lib/types";

/* ====================================================================== */
/* P2-S8 — Harvest-planning read-port (ADR-003 derived-read).             */
/* Two derived views power the /plan planner and S5's morning dispatch:    */
/*   • v_harvest_readiness — every plot's DERIVED readiness (GDD progress   */
/*     toward bloom→cherry, nudged by NDVI, staggered by altitude). Never a */
/*     hand-set flag; computed in-DB so the badge and the rank always agree.*/
/*   • v_pasada_calendar — the ACTIVE (non-superseded) pasada schedule.     */
/* This module only READS. The sole write paths are the command RPCs        */
/* (schedule_pasada / replan_pasada / record_maturation_signal), owned by   */
/* the Server Actions, not here. Mirrors the eudr.ts / plots.ts shape:      */
/* Row iface + pure map + cache().                                          */
/* ====================================================================== */

/** A `v_harvest_readiness` row as PostgREST returns it (snake_case; numerics may
 *  arrive as strings). */
export interface PlotReadinessRow {
  plot_id: string;
  plot_name: string;
  variety: CoffeeVariety;
  altitude_masl: number | string;
  bloom_date: string | null;
  gdd_accumulated: number | string;
  gdd_to_cherry: number | string;
  ndvi_latest: number | string | null;
  recent_ripeness_pct: number | string | null;
  readiness: number | string;
  confidence: ReadinessConfidence;
  stagger_days: number | string;
  predicted_ready_date: string | null;
}

/** A `v_pasada_calendar` row as PostgREST returns it (snake_case). */
export interface PasadaPlanRow {
  id: number;
  plot_id: string;
  plot_name: string;
  variety: CoffeeVariety;
  altitude_masl: number | string;
  season: string;
  pasada_number: number | string;
  predicted_ready_date: string;
  predicted_ripe_pct: RipenessTarget;
  status: PasadaStatus;
  reason: string | null;
  fired_task_id: string | null;
}

/** Coerce a possibly-null numeric string to a number, preserving null. */
const numOrNull = (v: number | string | null): number | null =>
  v === null ? null : Number(v);

/** Pure row → domain mapper for a plot's derived readiness. */
export function mapPlotReadiness(r: PlotReadinessRow): PlotReadiness {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    variety: r.variety,
    altitudeMasl: Number(r.altitude_masl),
    bloomDate: r.bloom_date,
    gddAccumulated: Number(r.gdd_accumulated),
    gddToCherry: Number(r.gdd_to_cherry),
    ndviLatest: numOrNull(r.ndvi_latest),
    recentRipenessPct: numOrNull(r.recent_ripeness_pct),
    readiness: Number(r.readiness),
    confidence: r.confidence,
    staggerDays: Number(r.stagger_days),
    predictedReadyDate: r.predicted_ready_date,
  };
}

/** Pure row → domain mapper for a scheduled pasada. */
export function mapPasadaPlan(r: PasadaPlanRow): PasadaPlan {
  return {
    id: Number(r.id),
    plotId: r.plot_id,
    plotName: r.plot_name,
    variety: r.variety,
    altitudeMasl: Number(r.altitude_masl),
    season: r.season,
    pasadaNumber: Number(r.pasada_number),
    predictedReadyDate: r.predicted_ready_date,
    ripenessTarget: r.predicted_ripe_pct,
    status: r.status,
    reason: r.reason,
    firedTaskId: r.fired_task_id,
  };
}

/**
 * Every plot's DERIVED harvest-readiness, most-ready first — the input S5 dispatch
 * reads to draft the morning card. Ordered by readiness desc so the plots ready to
 * pick this week surface at the top; the altitude stagger is already baked into
 * each row's predicted date.
 */
export const getHarvestReadiness = cache(async (): Promise<PlotReadiness[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_harvest_readiness")
    .select("*")
    .order("readiness", { ascending: false });
  if (error) throw new Error(`getHarvestReadiness: ${error.message}`);
  return (data as PlotReadinessRow[]).map(mapPlotReadiness);
});

/**
 * The active pasada calendar — every non-superseded harvest pass, staggered down
 * the altitude gradient. Ordered by predicted ready date then altitude so the
 * timeline reads as a wave moving up the mountain.
 */
export const getPasadaCalendar = cache(async (): Promise<PasadaPlan[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_pasada_calendar")
    .select("*")
    .order("predicted_ready_date", { ascending: true })
    .order("altitude_masl", { ascending: true });
  if (error) throw new Error(`getPasadaCalendar: ${error.message}`);
  return (data as PasadaPlanRow[]).map(mapPasadaPlan);
});
