import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CoffeeVariety,
  DispatchCard,
  DispatchChannel,
  DispatchPlot,
  DispatchStatus,
  RipenessTarget,
} from "@/lib/types";

/* ====================================================================== */
/* P2-S5 — Morning crew dispatch read-port (ADR-003 derived-read).         */
/* The /dispatch board renders the ACTIVE (non-superseded) per-crew card    */
/* the manager generated at dawn. Three derived views feed it; this module  */
/* reads two of them to assemble the renderable card:                       */
/*   • v_dispatch_card — one row per active run (crew, date, status,         */
/*     channel, threshold, plot_count) — the card's header.                 */
/*   • v_dispatch_card_plots — the per-plot lines (plot, variety, altitude,  */
/*     ripeness band + DERIVED readiness snapshotted at plan time, ord),     */
/*     joined so the card reads "Norte Bajo (Catuaí, 1,400 masl)".          */
/* This module only READS. The write paths are the command RPCs              */
/* (generate_dispatch / mark_dispatch_sent / record_dispatch_ack) — owned by */
/* the Server Actions, never here. Mirrors planning.ts: Row iface + pure map */
/* + cache()'d getter. The plot lines are sorted in DISPLAY order (ord asc,  */
/* then readiness desc) so the card always reads as the wave down the        */
/* altitude gradient regardless of the row order PostgREST returns.          */
/* ====================================================================== */

/** A `v_dispatch_card` row as PostgREST returns it (snake_case; numerics may
 *  arrive as strings). */
export interface DispatchCardRow {
  id: number | string;
  crew_id: string;
  crew_name: string;
  dispatch_date: string;
  season: string;
  status: DispatchStatus;
  sent_channel: DispatchChannel | null;
  readiness_threshold: number | string;
  idempotency_key: string | null;
  plot_count: number | string;
}

/** A `v_dispatch_card_plots` row as PostgREST returns it (snake_case; numerics
 *  may arrive as strings). */
export interface DispatchCardPlotRow {
  id: number | string;
  dispatch_run_id: number | string;
  plot_id: string;
  plot_name: string;
  variety: CoffeeVariety;
  altitude_masl: number | string;
  task_kind: string;
  target_kg: number | string | null;
  ripeness_target: RipenessTarget;
  readiness: number | string;
  ord: number | string;
}

/** Coerce a possibly-null numeric string to a number, preserving null. */
const numOrNull = (v: number | string | null): number | null =>
  v === null ? null : Number(v);

/** Pure row → domain mapper for one plot line of a dispatch card. */
export function mapDispatchPlot(r: DispatchCardPlotRow): DispatchPlot {
  return {
    id: Number(r.id),
    dispatchRunId: Number(r.dispatch_run_id),
    plotId: r.plot_id,
    plotName: r.plot_name,
    variety: r.variety,
    altitudeMasl: Number(r.altitude_masl),
    taskKind: r.task_kind,
    targetKg: numOrNull(r.target_kg),
    ripenessTarget: r.ripeness_target,
    readiness: Number(r.readiness),
    ord: Number(r.ord),
  };
}

/**
 * Pure row → domain mapper for a dispatch card. Assembles the run header with its
 * plot lines, sorted into DISPLAY order: ord ascending (the pasada/readiness
 * sequence the command stamped), ties broken by readiness descending (most-ready
 * first) — so the rendered card always reads as the wave down the gradient even
 * if PostgREST hands the plot rows back in another order.
 */
export function mapDispatchCard(
  cardRow: DispatchCardRow,
  plotRows: DispatchCardPlotRow[],
): DispatchCard {
  const plots = plotRows
    .map(mapDispatchPlot)
    .sort((a, b) => a.ord - b.ord || b.readiness - a.readiness);
  return {
    id: Number(cardRow.id),
    crewId: cardRow.crew_id,
    crewName: cardRow.crew_name,
    dispatchDate: cardRow.dispatch_date,
    season: cardRow.season,
    status: cardRow.status,
    sentChannel: cardRow.sent_channel,
    readinessThreshold: Number(cardRow.readiness_threshold),
    idempotencyKey: cardRow.idempotency_key,
    plotCount: Number(cardRow.plot_count),
    plots,
  };
}

/**
 * Every ACTIVE crew's morning dispatch card, ordered by crew name. Reads
 * v_dispatch_card for the headers and v_dispatch_card_plots ONCE (grouped by run
 * in memory — no N+1), then assembles each card with its plot lines in display
 * order. The /dispatch board renders these; the manager curates and shares.
 */
export const getDispatchToday = cache(async (): Promise<DispatchCard[]> => {
  const client = await getSupabase();

  const { data: cardData, error: cardError } = await client
    .from("v_dispatch_card")
    .select("*")
    .order("crew_name", { ascending: true });
  if (cardError) throw new Error(`getDispatchToday: ${cardError.message}`);

  const { data: plotData, error: plotError } = await client
    .from("v_dispatch_card_plots")
    .select("*");
  if (plotError) throw new Error(`getDispatchToday: ${plotError.message}`);

  // Group the plot lines by their run id once (avoids a per-card query).
  const plotsByRun = new Map<number, DispatchCardPlotRow[]>();
  for (const row of plotData as DispatchCardPlotRow[]) {
    const runId = Number(row.dispatch_run_id);
    const bucket = plotsByRun.get(runId);
    if (bucket) bucket.push(row);
    else plotsByRun.set(runId, [row]);
  }

  return (cardData as DispatchCardRow[]).map((cardRow) =>
    mapDispatchCard(cardRow, plotsByRun.get(Number(cardRow.id)) ?? []),
  );
});
