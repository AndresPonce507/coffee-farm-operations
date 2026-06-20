import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/** Traceability lot codes (JC-###) — used by the harvest + processing forms. */
export const getLots = cache(async (): Promise<string[]> => {
  const { data, error } = await (await getSupabase())
    .from("lots")
    .select("code")
    .order("code");
  if (error) throw new Error(`getLots: ${error.message}`);
  return (data as { code: string }[]).map((r) => r.code);
});
