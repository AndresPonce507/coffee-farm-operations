import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * Source lots the GRADE / materialize-green step may offer (review finding #16).
 *
 * Grading promotes a finished MILLED lot into a located, available-to-promise
 * GREEN lot (the `materialize_green_lot` RPC routes its mass into a new green node
 * via one conserved 'process' edge). So the only valid source is a lot at
 * stage='milled' that has NOT already been graded — i.e. is not yet the parent of
 * a 'process' edge leading to a green child.
 *
 * The RPC is idempotent on the green code, so a re-grade can never double-route
 * mass; but the UI must not even offer an already-spent source — re-presenting it
 * would invite a confusing second submission. The exclusion is derived in JS from
 * the full edge set (mirroring the `getLotGenealogy` JS-scoping pattern in
 * `lots.ts`) so raw lot-code text is never interpolated into a PostgREST filter.
 *
 * Mirrors the `getLots` / `getHarvestableLots` read-port style.
 */
export const getGradableLots = cache(async (): Promise<string[]> => {
  const supabase = await getSupabase();

  // Milled-stage lots — the candidate sources, ordered for a stable dropdown.
  const { data: lotData, error: lotError } = await supabase
    .from("lots")
    .select("code")
    .eq("stage", "milled")
    .order("code");
  if (lotError) throw new Error(`getGradableLots: ${lotError.message}`);

  // Every 'process' edge — its parent is a source already graded into a green
  // node, so it must drop out of the candidate list.
  const { data: edgeData, error: edgeError } = await supabase
    .from("lot_edges")
    .select("parent_code,kind");
  if (edgeError) throw new Error(`getGradableLots: ${edgeError.message}`);

  const graded = new Set(
    (edgeData as { parent_code: string; kind: string }[])
      .filter((e) => e.kind === "process")
      .map((e) => e.parent_code),
  );

  return (lotData as { code: string }[])
    .map((r) => r.code)
    .filter((code) => !graded.has(code));
});
