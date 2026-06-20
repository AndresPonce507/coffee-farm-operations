import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { ActivityItem } from "@/lib/types";

export interface ActivityRow {
  id: string;
  at: string;
  kind: ActivityItem["kind"];
  text: string;
}

export function mapActivity(r: ActivityRow): ActivityItem {
  return { id: r.id, at: r.at, kind: r.kind, text: r.text };
}

export const getActivity = cache(async (): Promise<ActivityItem[]> => {
  const { data, error } = await (await getSupabase())
    .from("activity")
    .select("*")
    .order("at", { ascending: false })
    .order("id");
  if (error) throw new Error(`getActivity: ${error.message}`);
  return (data as ActivityRow[]).map(mapActivity);
});
