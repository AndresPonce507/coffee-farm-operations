import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { WeatherDay } from "@/lib/types";

export interface WeatherRow {
  sort_order: number;
  day: string;
  hi: number;
  lo: number;
  rain_pct: number;
  icon: WeatherDay["icon"];
}

export function mapWeather(r: WeatherRow): WeatherDay {
  return {
    day: r.day,
    hi: Number(r.hi),
    lo: Number(r.lo),
    rainPct: Number(r.rain_pct),
    icon: r.icon,
  };
}

export const getWeather = cache(async (): Promise<WeatherDay[]> => {
  const { data, error } = await (await getSupabase())
    .from("weather")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(`getWeather: ${error.message}`);
  return (data as WeatherRow[]).map(mapWeather);
});
