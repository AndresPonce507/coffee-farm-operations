"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/types";
import { TASK_STATUSES } from "@/lib/enums";
import { formToRecord, trimmed } from "@/lib/validation/shared";
import { validateTask, type TaskInput } from "@/lib/validation/tasks";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

const toRow = (t: TaskInput) => ({
  title: t.title,
  category: t.category,
  plot_id: t.plotId,
  worker_id: t.workerId,
  due: t.due,
  status: t.status,
  priority: t.priority,
});

function refresh() {
  reactiveRefresh("task");
}

export async function createTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = validateTask(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb
    .from("tasks")
    .insert({ id: crypto.randomUUID(), ...toRow(parsed.data) });
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Task added." };
}

export async function updateTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = trimmed(formData.get("id"));
  if (!id) return { status: "error", message: "Missing task id." };

  const parsed = validateTask(formToRecord(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const sb = await getSupabase();
  const { error } = await sb.from("tasks").update(toRow(parsed.data)).eq("id", id);
  if (error) return { status: "error", message: error.message };

  refresh();
  return { status: "success", message: "Task updated." };
}

export async function deleteTask(id: string): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing task id." };
  const sb = await getSupabase();
  const { error } = await sb.from("tasks").delete().eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Task deleted." };
}

export async function setTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<ActionState> {
  if (!id) return { status: "error", message: "Missing task id." };
  if (!TASK_STATUSES.includes(status)) {
    return { status: "error", message: "Invalid status." };
  }
  const sb = await getSupabase();
  const { error } = await sb.from("tasks").update({ status }).eq("id", id);
  if (error) return { status: "error", message: error.message };
  refresh();
  return { status: "success", message: "Status updated." };
}
