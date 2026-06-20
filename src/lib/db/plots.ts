import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { CoffeeVariety, Plot, PlotStatus } from "@/lib/types";

/** Shape of a `plots` row as returned by PostgREST (snake_case). */
export interface PlotRow {
  id: string;
  ord: number;
  name: string;
  block: string;
  variety: CoffeeVariety;
  area_ha: number | string;
  altitude_masl: number;
  trees: number;
  shade_pct: number;
  established_year: number;
  status: PlotStatus;
  last_inspected: string;
  expected_yield_kg: number | string;
  harvested_kg: number | string;
}

/** Pure row → domain mapper (snake_case → camelCase, numeric coercion). */
export function mapPlot(r: PlotRow): Plot {
  return {
    id: r.id,
    name: r.name,
    block: r.block,
    variety: r.variety,
    areaHa: Number(r.area_ha),
    altitudeMasl: Number(r.altitude_masl),
    trees: Number(r.trees),
    shadePct: Number(r.shade_pct),
    establishedYear: Number(r.established_year),
    status: r.status,
    lastInspected: r.last_inspected,
    expectedYieldKg: Number(r.expected_yield_kg),
    harvestedKg: Number(r.harvested_kg),
  };
}

export const getPlots = cache(async (): Promise<Plot[]> => {
  const { data, error } = await (await getSupabase())
    .from("plots_view")
    .select("*")
    .order("ord");
  if (error) throw new Error(`getPlots: ${error.message}`);
  return (data as PlotRow[]).map(mapPlot);
});

export const getPlotById = cache(
  async (id: string): Promise<Plot | undefined> => {
    const { data, error } = await (await getSupabase())
      .from("plots_view")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`getPlotById: ${error.message}`);
    return data ? mapPlot(data as PlotRow) : undefined;
  },
);
