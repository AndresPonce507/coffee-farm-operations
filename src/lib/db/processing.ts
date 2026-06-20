import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  BatchStage,
  CoffeeVariety,
  ProcessMethod,
  ProcessingBatch,
} from "@/lib/types";

export interface BatchRow {
  id: string;
  lot_code: string;
  variety: CoffeeVariety;
  method: ProcessMethod;
  stage: BatchStage;
  started_date: string;
  cherries_kg: number | string;
  current_kg: number | string;
  moisture_pct: number | string;
  patio: string;
  progress_pct: number;
}

export function mapBatch(r: BatchRow): ProcessingBatch {
  return {
    id: r.id,
    lotCode: r.lot_code,
    variety: r.variety,
    method: r.method,
    stage: r.stage,
    startedDate: r.started_date,
    cherriesKg: Number(r.cherries_kg),
    currentKg: Number(r.current_kg),
    moisturePct: Number(r.moisture_pct),
    patio: r.patio,
    progressPct: Number(r.progress_pct),
  };
}

export const getBatches = cache(async (): Promise<ProcessingBatch[]> => {
  // Pipeline order: earliest stage first, newest within a stage — matches the source.
  const { data, error } = await (await getSupabase())
    .from("processing_batches")
    .select("*")
    .order("progress_pct", { ascending: true })
    .order("started_date", { ascending: false });
  if (error) throw new Error(`getBatches: ${error.message}`);
  return (data as BatchRow[]).map(mapBatch);
});
