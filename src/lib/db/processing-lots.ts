import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { BatchStage } from "@/lib/types";

/**
 * Processing read-port: the LOT's authoritative pipeline stage per `lot_code`.
 *
 * The Processing board renders `processing_batches` rows, but the advance write
 * (the hardened `advance_processing_stage` RPC) moves `lots.stage` /
 * `lots.current_kg` — a DIFFERENT table. Rendering `processing_batches.stage`
 * therefore showed a STALE stage after an advance, and a lot_code with several
 * batch rows rendered several Advance buttons all mutating one shared lot.
 *
 * This port reads `lots.stage` keyed by `lots.code`, so the board can derive the
 * displayed "from" stage from the SAME table the advance moves — one coherent
 * stage per lot. A NULL `lots.stage` (a bare seed lot) is coerced to `'cherry'`,
 * mirroring the advance RPC's NULL-stage guard (migration 20260621120000) so the
 * UI never disagrees with what the DB will enforce.
 *
 * Read-only and request-scoped (`cache()`), like the sibling `*.ts` read ports;
 * the sole writer of `lots.stage` is the `advance_processing_stage` RPC.
 */

/** Shape of the narrow `lots` projection this port reads (snake_case). */
export interface LotStageRow {
  code: string;
  stage: BatchStage | string | null;
}

/**
 * A `lot_code → lots.stage` map for every promoted lot. A NULL stage coerces to
 * `'cherry'` (the pipeline start) so the board's "from" stage matches the
 * advance RPC's NULL-stage handling.
 */
export const getLotStages = cache(async (): Promise<Map<string, BatchStage>> => {
  const { data, error } = await (await getSupabase())
    .from("lots")
    .select("code, stage")
    .order("code");
  if (error) throw new Error(`getLotStages: ${error.message}`);

  const stages = new Map<string, BatchStage>();
  for (const r of data as LotStageRow[]) {
    // NULL stage → 'cherry' (matches the advance RPC's NULL-stage guard).
    stages.set(r.code, (r.stage ?? "cherry") as BatchStage);
  }
  return stages;
});
