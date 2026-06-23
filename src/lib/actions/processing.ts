"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";
import { formToRecord, trimmed } from "@/lib/validation/shared";
import { validateBatch, type BatchInput } from "@/lib/validation/processing";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

const toRow = (b: BatchInput) => ({
  lot_code: b.lotCode,
  variety: b.variety,
  method: b.method,
  stage: b.stage,
  started_date: b.startedDate,
  cherries_kg: b.cherriesKg,
  current_kg: b.currentKg,
  moisture_pct: b.moisturePct,
  patio: b.patio,
  progress_pct: b.progressPct,
});

function refresh() {
  reactiveRefresh("processing-batch");
}

export async function createBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = validateBatch(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("processing_batches")
    .insert({ id: crypto.randomUUID(), ...toRow(parsed.data) });
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Batch added." };
}

export async function updateBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = trimmed(formData.get("id"));
  if (!id) return { status: "error", message: "Missing batch id." };

  const parsed = validateBatch(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("processing_batches")
    .update(toRow(parsed.data))
    .eq("id", id);
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Batch updated." };
}

export async function deleteBatch(id: string): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing batch id." };
  const sb = await getSupabase();
  const { error } = await sb
    .from("processing_batches")
    .delete()
    .eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Batch deleted." };
}
