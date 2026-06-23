import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P2-S2 — per-picker weigh-capture read-port (THE GENESIS FIELD EVENT).   */
/* The read side of the weigh-in: today's running tally per picker and per  */
/* plot, the Σ-kg-per-lot mill-intake number, and the kg-conservation       */
/* reconciliation signal — each read from the frozen DB contract            */
/* (v_weigh_today_by_picker / v_weigh_today_by_plot / v_weigh_by_lot /      */
/* v_lot_weigh_reconciliation views + the weigh_event ledger). Writes never  */
/* flow through here — they go through the record_weigh_in command RPC.      */
/* Mirrors the people.ts / harvests.ts shape: Row iface + pure map +         */
/* cache()'d getter, snake_case → camelCase, numeric coercion via Number().  */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* Today by picker — v_weigh_today_by_picker                              */
/* ---------------------------------------------------------------------- */

/** A `v_weigh_today_by_picker` row as PostgREST returns it (snake_case). */
export interface WeighByPickerRow {
  worker_id: string;
  name: string;
  crew_id: string | null;
  lata_count: number | string;
  kg_today: number | string;
  last_weigh_at: string | null;
}

/** Domain shape of one picker's running tally for today (camelCase). */
export interface WeighByPicker {
  workerId: string;
  name: string;
  crewId: string | null;
  lataCount: number;
  kgToday: number;
  lastWeighAt: string | null;
}

/** Pure row → domain mapper. */
export function mapWeighByPicker(r: WeighByPickerRow): WeighByPicker {
  return {
    workerId: r.worker_id,
    name: r.name,
    crewId: r.crew_id,
    lataCount: Number(r.lata_count),
    kgToday: Number(r.kg_today),
    lastWeighAt: r.last_weigh_at,
  };
}

/**
 * Today's per-picker tally — each picker's lata count + kg captured today, the
 * running total the <3s weigh screen shows back after each capture. Highest first.
 */
export const getWeighTodayByPicker = cache(
  async (): Promise<WeighByPicker[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_weigh_today_by_picker")
      .select("*")
      .order("kg_today", { ascending: false });
    if (error) throw new Error(`getWeighTodayByPicker: ${error.message}`);
    return (data as WeighByPickerRow[]).map(mapWeighByPicker);
  },
);

/**
 * ONE picker's today weigh tally — the /workers/[id] dossier's Kg/weigh section
 * (Phase 5 L2, facet-02 §7). Reads the SAME `v_weigh_today_by_picker` view
 * getWeighTodayByPicker() reads, narrowed to a single worker (the worker id is the
 * same handle entityHref.worker links with). Returns null when the worker has not
 * weighed in today (honest empty — the section shows its zero state, never a
 * fabricated tally). Read-only.
 */
export const getWorkerWeighSummary = cache(
  async (workerId: string): Promise<WeighByPicker | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_weigh_today_by_picker")
      .select("*")
      .eq("worker_id", workerId)
      .maybeSingle();
    if (error) throw new Error(`getWorkerWeighSummary: ${error.message}`);
    return data ? mapWeighByPicker(data as WeighByPickerRow) : null;
  },
);

/* ---------------------------------------------------------------------- */
/* Today by plot — v_weigh_today_by_plot                                  */
/* ---------------------------------------------------------------------- */

/** A `v_weigh_today_by_plot` row as PostgREST returns it (snake_case). */
export interface WeighByPlotRow {
  plot_id: string;
  plot_name: string;
  lata_count: number | string;
  kg_today: number | string;
  all_geofence_ok: boolean | null;
}

/** Domain shape of one plot's weigh totals for today (camelCase). */
export interface WeighByPlot {
  plotId: string;
  plotName: string;
  lataCount: number;
  kgToday: number;
  allGeofenceOk: boolean | null;
}

/** Pure row → domain mapper. */
export function mapWeighByPlot(r: WeighByPlotRow): WeighByPlot {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    lataCount: Number(r.lata_count),
    kgToday: Number(r.kg_today),
    allGeofenceOk: r.all_geofence_ok,
  };
}

/** Today's per-plot weigh totals — which plots are being picked and how much. */
export const getWeighTodayByPlot = cache(async (): Promise<WeighByPlot[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_weigh_today_by_plot")
    .select("*")
    .order("kg_today", { ascending: false });
  if (error) throw new Error(`getWeighTodayByPlot: ${error.message}`);
  return (data as WeighByPlotRow[]).map(mapWeighByPlot);
});

/* ---------------------------------------------------------------------- */
/* Per-lot mill-intake — v_weigh_by_lot                                   */
/* ---------------------------------------------------------------------- */

/** A `v_weigh_by_lot` row as PostgREST returns it (snake_case). */
export interface WeighByLotRow {
  lot_code: string;
  lata_count: number | string;
  weigh_kg: number | string;
  origin_kg: number | string | null;
}

/** Domain shape of one lot's Σ-kg mill-intake number (camelCase). */
export interface WeighByLot {
  lotCode: string;
  lataCount: number;
  weighKg: number;
  originKg: number | null;
}

/** Pure row → domain mapper. */
export function mapWeighByLot(r: WeighByLotRow): WeighByLot {
  return {
    lotCode: r.lot_code,
    lataCount: Number(r.lata_count),
    weighKg: Number(r.weigh_kg),
    originKg: r.origin_kg === null ? null : Number(r.origin_kg),
  };
}

/**
 * One lot's cherry mill-intake — Σ weigh_event.kg for the lot (the number the mill
 * + payroll read), alongside its lots.origin_kg for the conservation check.
 */
export const getWeighByLot = cache(
  async (lotCode: string): Promise<WeighByLot | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_weigh_by_lot")
      .select("*")
      .eq("lot_code", lotCode)
      .maybeSingle();
    if (error) throw new Error(`getWeighByLot: ${error.message}`);
    return data ? mapWeighByLot(data as WeighByLotRow) : null;
  },
);

/* ---------------------------------------------------------------------- */
/* Weigh-event ledger — weigh_event (append-only)                         */
/* ---------------------------------------------------------------------- */

/** A `weigh_event` row as PostgREST returns it (snake_case). */
export interface WeighEventRow {
  event_uid: string;
  worker_id: string;
  crew_id: string | null;
  plot_id: string;
  lot_code: string;
  kg: number | string;
  ripeness: string;
  brix: number | string | null;
  scale_source: string;
  geofence_ok: boolean | null;
  occurred_at: string;
  recorded_at: string;
}

/** Domain shape of one append-only weigh event (camelCase). */
export interface WeighEvent {
  eventUid: string;
  workerId: string;
  crewId: string | null;
  plotId: string;
  lotCode: string;
  kg: number;
  ripeness: string;
  brix: number | null;
  scaleSource: string;
  geofenceOk: boolean | null;
  occurredAt: string;
  recordedAt: string;
}

/** Pure row → domain mapper (numeric coercion of kg/brix). */
export function mapWeighEvent(r: WeighEventRow): WeighEvent {
  return {
    eventUid: r.event_uid,
    workerId: r.worker_id,
    crewId: r.crew_id,
    plotId: r.plot_id,
    lotCode: r.lot_code,
    kg: Number(r.kg),
    ripeness: r.ripeness,
    brix: r.brix === null ? null : Number(r.brix),
    scaleSource: r.scale_source,
    geofenceOk: r.geofence_ok,
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
  };
}

/**
 * One lot's append-only weigh-event timeline — every lata emptied into it, newest
 * first. The genesis evidence behind the lot's cherry mass.
 */
export const getWeighEventsForLot = cache(
  async (lotCode: string): Promise<WeighEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("weigh_event")
      .select(
        "event_uid,worker_id,crew_id,plot_id,lot_code,kg,ripeness,brix,scale_source,geofence_ok,occurred_at,recorded_at",
      )
      .eq("lot_code", lotCode)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`getWeighEventsForLot: ${error.message}`);
    return (data as WeighEventRow[]).map(mapWeighEvent);
  },
);

/* ---------------------------------------------------------------------- */
/* Plots for the weigh surface — id/name + centroid (GPS auto-select)     */
/* ---------------------------------------------------------------------- */

/** A `plots` row carrying just the geofence reference (GeoJSON centroid jsonb). */
interface WeighPlotRow {
  id: string;
  name: string;
  centroid: { coordinates?: [number, number] } | null;
}

/** A plot the weigh surface offers, with its centroid lat/lng for GPS auto-select. */
export interface WeighPlot {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Pure row → domain mapper (GeoJSON [lng, lat] → {lat, lng}). */
export function mapWeighPlot(r: WeighPlotRow): WeighPlot {
  const coords = r.centroid?.coordinates;
  return {
    id: r.id,
    name: r.name,
    lat: coords ? coords[1] : null,
    lng: coords ? coords[0] : null,
  };
}

/**
 * The plots the weigh surface badges against — id, name, and the centroid lat/lng
 * the GPS auto-select uses to confirm the nearest plot. Ordered by curated display
 * order. Reads the `centroid` jsonb directly (the spine stores geometry as GeoJSON;
 * no PostGIS).
 */
export const getWeighPlots = cache(async (): Promise<WeighPlot[]> => {
  const { data, error } = await (await getSupabase())
    .from("plots")
    .select("id,name,centroid")
    .order("ord");
  if (error) throw new Error(`getWeighPlots: ${error.message}`);
  return (data as WeighPlotRow[]).map(mapWeighPlot);
});
