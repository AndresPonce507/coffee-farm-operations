"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";
import { formToRecord, trimmed } from "@/lib/validation/shared";
import { validatePlot, type PlotInput } from "@/lib/validation/plots";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

/** PlotInput (camelCase) → `plots` row (snake_case). Never writes harvested_kg. */
const toRow = (p: PlotInput) => ({
  name: p.name,
  block: p.block,
  variety: p.variety,
  area_ha: p.areaHa,
  altitude_masl: p.altitudeMasl,
  trees: p.trees,
  shade_pct: p.shadePct,
  established_year: p.establishedYear,
  status: p.status,
  last_inspected: p.lastInspected,
  expected_yield_kg: p.expectedYieldKg,
});

function refresh() {
  reactiveRefresh("plot");
}

export async function createPlot(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = validatePlot(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();

  // `ord` drives the table's display order; append the new plot at the end.
  const { data: maxRows, error: ordError } = await sb
    .from("plots")
    .select("ord")
    .order("ord", { ascending: false })
    .limit(1);
  if (ordError) return { status: "error", message: ordError.message };
  const ord = (maxRows?.[0]?.ord ?? -1) + 1;

  const { error } = await sb
    .from("plots")
    .insert({ id: crypto.randomUUID(), ord, ...toRow(parsed.data) });
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Plot added." };
}

export async function updatePlot(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = trimmed(formData.get("id"));
  if (!id) return { status: "error", message: "Missing plot id." };

  const parsed = validatePlot(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb.from("plots").update(toRow(parsed.data)).eq("id", id);
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Plot updated." };
}

export async function deletePlot(id: string): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing plot id." };
  const sb = await getSupabase();
  const { error } = await sb.from("plots").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Plot deleted." };
}
