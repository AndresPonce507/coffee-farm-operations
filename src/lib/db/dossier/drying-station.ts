import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import {
  getDryingLots,
  getDryingWeatherRisk,
  mapStationOccupancy,
  type StationOccupancyRow,
} from "@/lib/db/drying";
import type { DryingLot, DryingWeatherRisk, StationOccupancy } from "@/lib/types";

/**
 * Drying-station dossier read-ports (Phase 5 — the 8th connected entity).
 *
 * Mirrors the crew/worker dossier loaders: one cheap anchor getter (the existence
 * gate the page 404s on) plus two derived section reads filtered to this station from
 * the frozen `getDryingLots` / `getDryingWeatherRisk` ports (imported, never forked).
 * All `cache()`d so the page's Promise.all fans out with no duplicate queries.
 */

/** The anchor station — one `station_occupancy` row, or null for an unknown id. */
export const getDryingStationById = cache(
  async (id: string): Promise<StationOccupancy | null> => {
    const sb = await getSupabase();
    const { data, error } = await sb
      .from("station_occupancy")
      .select("*")
      .eq("station_id", id)
      .maybeSingle();
    if (error) throw new Error(`getDryingStationById: ${error.message}`);
    return data ? mapStationOccupancy(data as StationOccupancyRow) : null;
  },
);

/** The lots currently resting on this station (each cross-links to its lot dossier). */
export const getDryingStationLots = cache(
  async (id: string): Promise<DryingLot[]> => {
    const lots = await getDryingLots();
    return lots.filter((l) => l.stationId === id);
  },
);

/** This station's upcoming weather-cover forecast (open-air beds only carry risk). */
export const getDryingStationWeatherRisk = cache(
  async (id: string): Promise<DryingWeatherRisk[]> => {
    const risk = await getDryingWeatherRisk();
    return risk
      .filter((r) => r.stationId === id)
      .sort((a, b) => a.forecastOrder - b.forecastOrder);
  },
);
