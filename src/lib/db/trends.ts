import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { CoffeeVariety, TrendPoint, VarietyShare } from "@/lib/types";

/* ---------------- Trend points (daily / weekly) ---------------- */
export interface TrendRow {
  sort_order: number;
  label: string;
  value: number | string;
}
export function mapTrend(r: TrendRow): TrendPoint {
  return { label: r.label, value: Number(r.value) };
}

export const getDailyCherries = cache(async (): Promise<TrendPoint[]> => {
  const { data, error } = await (await getSupabase())
    .from("daily_cherries_view")
    .select("*")
    .order("on_date");
  if (error) throw new Error(`getDailyCherries: ${error.message}`);
  return (data as TrendRow[]).map(mapTrend);
});

export const getWeeklyHarvest = cache(async (): Promise<TrendPoint[]> => {
  const { data, error } = await (await getSupabase())
    .from("weekly_harvest_view")
    .select("*")
    .order("week_start");
  if (error) throw new Error(`getWeeklyHarvest: ${error.message}`);
  return (data as TrendRow[]).map(mapTrend);
});

/* ---------------- Variety shares ---------------- */
export interface VarietyShareRow {
  variety: CoffeeVariety;
  kg: number | string;
}
export function mapVarietyShare(r: VarietyShareRow): VarietyShare {
  return { variety: r.variety, kg: Number(r.kg) };
}

export const getVarietyShares = cache(async (): Promise<VarietyShare[]> => {
  const { data, error } = await (await getSupabase())
    .from("variety_shares_view")
    .select("*")
    .order("kg", { ascending: false });
  if (error) throw new Error(`getVarietyShares: ${error.message}`);
  return (data as VarietyShareRow[]).map(mapVarietyShare);
});

/* ---------------- Season summary (singleton) ---------------- */
export interface SeasonRow {
  id: number;
  target_kg: number | string;
  harvested_kg: number | string;
  today_kg: number | string;
  ytd_revenue_usd: number | string;
}
/** Mirrors the `SEASON` const shape from the mock data. */
export interface Season {
  targetKg: number;
  harvestedKg: number;
  todayKg: number;
  ytdRevenueUsd: number;
}
export function mapSeason(r: SeasonRow): Season {
  return {
    targetKg: Number(r.target_kg),
    harvestedKg: Number(r.harvested_kg),
    todayKg: Number(r.today_kg),
    ytdRevenueUsd: Number(r.ytd_revenue_usd),
  };
}

export const getSeason = cache(async (): Promise<Season> => {
  const { data, error } = await (await getSupabase())
    .from("season_summary_view")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`getSeason: ${error.message}`);
  return mapSeason(data as SeasonRow);
});

/* ---------------- Honest provenance (AD-4) ---------------- */
/**
 * Provenance for the season headline figures: how many harvest rows the metrics
 * were derived from, and the most-recent harvest date the views see.
 *
 * AD-4 requires a REAL row count + a REAL recency timestamp ("derived from N
 * harvests · HH:MM"), or the affordance is worse than nothing. Both come
 * straight from the `harvests` base table — the same rows the `*_view`
 * aggregates compute over — so the readout cannot drift from the figures.
 *
 * `asOf` is the max harvest date (empty string when no harvests exist yet).
 */
export interface SeasonProvenance {
  derivedFromCount: number;
  asOf: string;
}

export const getSeasonProvenance = cache(
  async (): Promise<SeasonProvenance> => {
    const { data, error, count } = await (await getSupabase())
      .from("harvests")
      .select("date", { count: "exact" })
      .order("date", { ascending: false })
      .limit(1);
    if (error) throw new Error(`getSeasonProvenance: ${error.message}`);
    const rows = (data ?? []) as Array<{ date: string }>;
    return {
      derivedFromCount: count ?? 0,
      asOf: rows[0]?.date ?? "",
    };
  },
);
