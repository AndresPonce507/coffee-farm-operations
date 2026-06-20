import { getSupabase } from "@/lib/supabase/server";
import type { Harvest } from "@/lib/types";

/** Row from `harvests_view` — plot_name + picker are re-joined from the anchors. */
export interface HarvestRow {
  id: string;
  date: string;
  plot_id: string;
  plot_name: string;
  picker: string;
  cherries_kg: number | string;
  ripeness_pct: number | string;
  brix_avg: number | string;
  lot_code: string;
}

export function mapHarvest(r: HarvestRow): Harvest {
  return {
    id: r.id,
    date: r.date,
    plotId: r.plot_id,
    plotName: r.plot_name,
    picker: r.picker,
    cherriesKg: Number(r.cherries_kg),
    ripenessPct: Number(r.ripeness_pct),
    brixAvg: Number(r.brix_avg),
    lotCode: r.lot_code,
  };
}

export async function getHarvests(): Promise<Harvest[]> {
  const { data, error } = await getSupabase()
    .from("harvests_view")
    .select("*")
    .order("date", { ascending: false })
    .order("id");
  if (error) throw new Error(`getHarvests: ${error.message}`);
  return (data as HarvestRow[]).map(mapHarvest);
}
