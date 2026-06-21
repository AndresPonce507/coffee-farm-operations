import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * Lot codes that can legitimately receive fresh cherry intake (FINDING #35).
 *
 * A harvest logs *cherries* against a lot, so the only valid targets are lots
 * still at the cherry stage (or not yet staged) — never a milled source or a
 * green export lot. Offering a green/milled lot here is nonsensical and, for a
 * green lot, would silently rewrite that lot's EUDR origin set and flip its
 * verdict. (A data-layer trigger already blocks green targets — mig
 * 20260621110000 — but the UI must not even offer them.)
 *
 * Mirrors the `getLots` read-port style in `lots.ts`.
 */
export const getHarvestableLots = cache(async (): Promise<string[]> => {
  const { data, error } = await (await getSupabase())
    .from("lots")
    .select("code")
    .or("stage.is.null,stage.eq.cherry")
    .order("code");
  if (error) throw new Error(`getHarvestableLots: ${error.message}`);
  return (data as { code: string }[]).map((r) => r.code);
});
