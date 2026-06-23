import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CoffeeVariety,
  DryingLot,
  DryingStationKind,
  DryingWeatherRisk,
  MoistureReading,
  ReposoStatus,
  StationOccupancy,
  WeatherDay,
} from "@/lib/types";

/* ====================================================================== */
/* P2-S4 — Drying management + THE REPOSO GATE read-port (ADR-003          */
/* derived-read). The reposo gate is enforced in the DATABASE (a           */
/* precondition inside advance_processing_stage + a BEFORE-UPDATE trigger  */
/* backstop on lots); this port only READS the derived projections that    */
/* let the UI explain the gate. The sole writers are the SECURITY DEFINER  */
/* command RPCs (record_moisture_reading, assign_drying_station). Mirrors   */
/* the greenlots.ts / processing-lots.ts read-port shape.                  */
/* ====================================================================== */

/* ---------------- station_occupancy view row ---------------- */

export interface StationOccupancyRow {
  station_id: string;
  name: string;
  kind: DryingStationKind | string;
  capacity_kg: number | string | null;
  committed_kg: number | string | null;
  available_kg: number | string | null;
}

/** Pure row → domain mapper for a station-occupancy row (numeric coercion of the
 *  capacity / committed / available columns PostgREST may serialize as strings). */
export function mapStationOccupancy(r: StationOccupancyRow): StationOccupancy {
  return {
    stationId: r.station_id,
    name: r.name,
    kind: r.kind,
    capacityKg: Number(r.capacity_kg ?? 0),
    committedKg: Number(r.committed_kg ?? 0),
    availableKg: Number(r.available_kg ?? 0),
  };
}

/* ---------------- v_reposo_status view row ---------------- */

export interface ReposoStatusRow {
  lot_code: string;
  latest_moisture: number | string | null;
  reading_count: number | string;
  moisture_stable: boolean;
  drying_started_at: string | null;
  rest_days_elapsed: number | string | null;
  rest_met: boolean;
  ready: boolean;
  reason: string;
}

/** Pure row → domain mapper for a reposo-status row. `latestMoisture` and
 *  `restDaysElapsed` stay NULL (never coerced to a fabricated 0) when a lot has no
 *  readings / no drying record — an honest "—" in the UI, not a fake number. */
export function mapReposoStatus(r: ReposoStatusRow): ReposoStatus {
  return {
    lotCode: r.lot_code,
    latestMoisture: r.latest_moisture == null ? null : Number(r.latest_moisture),
    readingCount: Number(r.reading_count ?? 0),
    moistureStable: r.moisture_stable,
    dryingStartedAt: r.drying_started_at,
    restDaysElapsed: r.rest_days_elapsed == null ? null : Number(r.rest_days_elapsed),
    restMet: r.rest_met,
    ready: r.ready,
    reason: r.reason,
  };
}

/* ---------------- moisture_readings row ---------------- */

export interface MoistureReadingRow {
  lot_code: string;
  moisture_pct: number | string;
  occurred_at: string;
}

/** Pure row → domain mapper for one moisture reading (numeric coercion of the pct). */
export function mapMoistureReading(r: MoistureReadingRow): MoistureReading {
  return {
    lotCode: r.lot_code,
    moisturePct: Number(r.moisture_pct),
    occurredAt: r.occurred_at,
  };
}

/* ---------------- v_drying_weather_risk view row ---------------- */

export interface DryingWeatherRiskRow {
  station_id: string;
  name: string;
  kind: DryingStationKind | string;
  forecast_order: number | string;
  day: string;
  rain_pct: number | string;
  icon: WeatherDay["icon"];
  cover_risk: boolean;
}

/** Pure row → domain mapper for a drying-station weather-cover-risk row. */
export function mapDryingWeatherRisk(r: DryingWeatherRiskRow): DryingWeatherRisk {
  return {
    stationId: r.station_id,
    name: r.name,
    kind: r.kind,
    forecastOrder: Number(r.forecast_order),
    day: r.day,
    rainPct: Number(r.rain_pct),
    icon: r.icon,
    coverRisk: r.cover_risk,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/** Live committed-vs-capacity occupancy for every drying station. */
export const getStationOccupancy = cache(async (): Promise<StationOccupancy[]> => {
  const { data, error } = await (await getSupabase())
    .from("station_occupancy")
    .select("*")
    .order("station_id");
  if (error) throw new Error(`getStationOccupancy: ${error.message}`);
  return (data as StationOccupancyRow[]).map(mapStationOccupancy);
});

/** The reposo-gate status for every lot currently in/through the resting state. */
export const getReposoStatuses = cache(async (): Promise<ReposoStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_reposo_status")
    .select("*")
    .order("lot_code");
  if (error) throw new Error(`getReposoStatuses: ${error.message}`);
  return (data as ReposoStatusRow[]).map(mapReposoStatus);
});

/* ---------------- reposo target band (farm_season_config) ---------------- */

export interface ReposoBand {
  min: number;
  max: number;
}

interface ReposoBandRow {
  reposo_moisture_min_pct: number | string | null;
  reposo_moisture_max_pct: number | string | null;
}

/**
 * The tunable reposo target band — the moisture window the gate enforces and the
 * curve must be drawn against. SSOT: `farm_season_config.reposo_moisture_min_pct`
 * / `reposo_moisture_max_pct` (the same columns the DB's reposo verdict reads), so
 * the band drawn in <MoistureCurve> can never drift from the window the family
 * tunes. The singleton config row is read LIMIT 1; the literal 10.5–11.5% fallback
 * matches the migration's column defaults for the (un-seeded) empty-config case.
 */
export const getReposoBand = cache(async (): Promise<ReposoBand> => {
  const { data, error } = await (await getSupabase())
    .from("farm_season_config")
    .select("reposo_moisture_min_pct, reposo_moisture_max_pct")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getReposoBand: ${error.message}`);
  const row = data as ReposoBandRow | null;
  return {
    min: row?.reposo_moisture_min_pct == null ? 10.5 : Number(row.reposo_moisture_min_pct),
    max: row?.reposo_moisture_max_pct == null ? 11.5 : Number(row.reposo_moisture_max_pct),
  };
});

/** Upcoming cover/move risk per open-air drying station (the weather-coupled alert). */
export const getDryingWeatherRisk = cache(async (): Promise<DryingWeatherRisk[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_drying_weather_risk")
    .select("*")
    .order("station_id")
    .order("forecast_order");
  if (error) throw new Error(`getDryingWeatherRisk: ${error.message}`);
  return (data as DryingWeatherRiskRow[]).map(mapDryingWeatherRisk);
});

/* ---------------- composite: per-lot drying view ---------------- */

interface OpenAssignmentRow {
  lot_code: string;
  station_id: string;
  released_at: string | null;
}
interface DryingLotMetaRow {
  code: string;
  variety: CoffeeVariety | string | null;
  current_kg: number | string | null;
}

/**
 * Compose the per-lot drying view the `/process/[lot]/drying` surface renders:
 * the reposo status + the lot's open station + its moisture curve, joined in app
 * code from the derived reads (each its own RLS-governed query). One DryingLot per
 * lot that has a reposo-status row (i.e. is in/through the resting state).
 */
export const getDryingLots = cache(async (): Promise<DryingLot[]> => {
  const sb = await getSupabase();
  const [statusesRes, occRes, curveRes, assignRes, lotsRes] = await Promise.all([
    sb.from("v_reposo_status").select("*").order("lot_code"),
    sb.from("station_occupancy").select("*").order("station_id"),
    sb.from("moisture_readings").select("lot_code, moisture_pct, occurred_at").order("occurred_at"),
    sb.from("drying_assignments").select("lot_code, station_id, released_at"),
    sb.from("lots").select("code, variety, current_kg"),
  ]);
  for (const [label, res] of [
    ["v_reposo_status", statusesRes],
    ["station_occupancy", occRes],
    ["moisture_readings", curveRes],
    ["drying_assignments", assignRes],
    ["lots", lotsRes],
  ] as const) {
    if (res.error) throw new Error(`getDryingLots(${label}): ${res.error.message}`);
  }

  const stations = new Map(
    (occRes.data as StationOccupancyRow[]).map((r) => [r.station_id, r.name]),
  );
  const openStationByLot = new Map<string, string>();
  for (const a of assignRes.data as OpenAssignmentRow[]) {
    if (a.released_at == null) openStationByLot.set(a.lot_code, a.station_id);
  }
  const lotMeta = new Map(
    (lotsRes.data as DryingLotMetaRow[]).map((r) => [r.code, r]),
  );
  const curveByLot = new Map<string, MoistureReading[]>();
  for (const r of curveRes.data as MoistureReadingRow[]) {
    const list = curveByLot.get(r.lot_code) ?? [];
    list.push(mapMoistureReading(r));
    curveByLot.set(r.lot_code, list);
  }

  return (statusesRes.data as ReposoStatusRow[]).map((sr) => {
    const reposo = mapReposoStatus(sr);
    const stationId = openStationByLot.get(reposo.lotCode) ?? null;
    const meta = lotMeta.get(reposo.lotCode);
    return {
      lotCode: reposo.lotCode,
      variety: meta?.variety ?? null,
      currentKg: meta?.current_kg == null ? null : Number(meta.current_kg),
      stationId,
      stationName: stationId ? stations.get(stationId) ?? null : null,
      reposo,
      curve: curveByLot.get(reposo.lotCode) ?? [],
    };
  });
});
