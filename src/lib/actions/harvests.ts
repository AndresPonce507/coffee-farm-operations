"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";
import { formToRecord, trimmed } from "@/lib/validation/shared";
import { validateHarvest, type HarvestInput } from "@/lib/validation/harvests";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

const toRow = (h: HarvestInput) => ({
  date: h.date,
  plot_id: h.plotId,
  worker_id: h.workerId,
  cherries_kg: h.cherriesKg,
  ripeness_pct: h.ripenessPct,
  brix_avg: h.brixAvg,
  lot_code: h.lotCode,
});

function refresh() {
  reactiveRefresh("cherry-intake");
}

export async function createHarvest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = validateHarvest(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("harvests")
    .insert({ id: crypto.randomUUID(), ...toRow(parsed.data) });
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Harvest added." };
}

export async function updateHarvest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = trimmed(formData.get("id"));
  if (!id) return { status: "error", message: "Missing harvest id." };

  const parsed = validateHarvest(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("harvests")
    .update(toRow(parsed.data))
    .eq("id", id);
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Harvest updated." };
}

export async function deleteHarvest(id: string): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing harvest id." };
  const sb = await getSupabase();
  const { error } = await sb.from("harvests").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Harvest deleted." };
}
