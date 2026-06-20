import { cache } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";

import { getSupabase } from "@/lib/supabase/server";
import type { CoffeeVariety, PlotStatus } from "@/lib/types";

/**
 * GeoJSON data-access for the farm map (S1). Geometry is stored as GeoJSON in
 * plain jsonb (no PostGIS — see 20260621090000_plot_geometry.sql), so the geom
 * column already IS GeoJSON; these getters just wrap rows into FeatureCollections
 * the MapLibre island can hand straight to a `geojson` source.
 *
 * Mirrors the plots.ts pattern: a *GeoRow interface, a pure map*Feature mapper,
 * and cache()'d getters using getSupabase().
 */

/** Properties carried on each plot Feature (consumed by map paint + chips). */
export interface PlotFeatureProps {
  id: string;
  name: string;
  block: string;
  variety: CoffeeVariety;
  status: PlotStatus;
  altitudeMasl: number;
}

export interface ReserveFeatureProps {
  id: string;
  name: string;
  kind: string;
  areaHa: number | null;
}

/** Row shape for the plot-geometry query (only geom-bearing plots). */
export interface PlotGeoRow {
  id: string;
  name: string;
  block: string;
  variety: CoffeeVariety;
  status: PlotStatus;
  altitude_masl: number;
  geom: Polygon;
}

export interface ReserveGeoRow {
  id: string;
  name: string;
  kind: string;
  area_ha: number | string | null;
  geom: Polygon;
}

/** Pure row → GeoJSON Feature mapper for a plot. */
export function mapPlotFeature(r: PlotGeoRow): Feature<Polygon, PlotFeatureProps> {
  return {
    type: "Feature",
    geometry: r.geom,
    properties: {
      id: r.id,
      name: r.name,
      block: r.block,
      variety: r.variety,
      status: r.status,
      altitudeMasl: Number(r.altitude_masl),
    },
  };
}

/** Pure row → GeoJSON Feature mapper for a reserve zone. */
export function mapReserveFeature(
  r: ReserveGeoRow,
): Feature<Polygon, ReserveFeatureProps> {
  return {
    type: "Feature",
    geometry: r.geom,
    properties: {
      id: r.id,
      name: r.name,
      kind: r.kind,
      areaHa: r.area_ha == null ? null : Number(r.area_ha),
    },
  };
}

export const getPlotsGeoJSON = cache(
  async (): Promise<FeatureCollection<Polygon, PlotFeatureProps>> => {
    const { data, error } = await (await getSupabase())
      .from("plots")
      .select("id, name, block, variety, status, altitude_masl, geom")
      .not("geom", "is", null)
      .order("ord");
    if (error) throw new Error(`getPlotsGeoJSON: ${error.message}`);
    return {
      type: "FeatureCollection",
      features: (data as PlotGeoRow[]).map(mapPlotFeature),
    };
  },
);

export const getReserveGeoJSON = cache(
  async (): Promise<FeatureCollection<Polygon, ReserveFeatureProps>> => {
    const { data, error } = await (await getSupabase())
      .from("reserve_zones")
      .select("id, name, kind, area_ha, geom")
      .order("id");
    if (error) throw new Error(`getReserveGeoJSON: ${error.message}`);
    return {
      type: "FeatureCollection",
      features: (data as ReserveGeoRow[]).map(mapReserveFeature),
    };
  },
);
