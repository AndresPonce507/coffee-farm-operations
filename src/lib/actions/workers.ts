"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";
import { formToRecord, trimmed } from "@/lib/validation/shared";
import { validateWorker, type WorkerInput } from "@/lib/validation/workers";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

// today_kg is intentionally omitted — the DB column defaults to 0 and becomes a
// computed view later, so the write forms never touch it.
const toRow = (w: WorkerInput) => ({
  name: w.name,
  role: w.role,
  daily_rate_usd: w.dailyRateUsd,
  attendance: w.attendance,
  started_year: w.startedYear,
  phone: w.phone,
  crew: w.crew,
});

function refresh() {
  reactiveRefresh("worker");
}

export async function createWorker(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = validateWorker(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("workers")
    .insert({ id: crypto.randomUUID(), ...toRow(parsed.data) });
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Worker added." };
}

export async function updateWorker(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = trimmed(formData.get("id"));
  if (!id) return { status: "error", message: "Missing worker id." };

  const parsed = validateWorker(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("workers")
    .update(toRow(parsed.data))
    .eq("id", id);
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Worker updated." };
}

export async function deleteWorker(id: string): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing worker id." };
  const sb = await getSupabase();
  const { error } = await sb.from("workers").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Worker deleted." };
}
