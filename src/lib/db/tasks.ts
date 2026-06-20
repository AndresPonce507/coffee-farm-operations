import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { FarmTask, Priority, TaskCategory, TaskStatus } from "@/lib/types";

/** Row from `tasks_view` — plot_name + assignee are re-joined from the anchors. */
export interface TaskRow {
  id: string;
  title: string;
  category: TaskCategory;
  plot_id: string | null;
  plot_name: string | null;
  assignee: string;
  due: string;
  status: TaskStatus;
  priority: Priority;
}

export function mapTask(r: TaskRow): FarmTask {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    plotId: r.plot_id,
    plotName: r.plot_name,
    assignee: r.assignee,
    due: r.due,
    status: r.status,
    priority: r.priority,
  };
}

export const getTasks = cache(async (): Promise<FarmTask[]> => {
  // Overdue-first then by due date — matches the curated source order.
  const { data, error } = await getSupabase()
    .from("tasks_view")
    .select("*")
    .order("due")
    .order("id");
  if (error) throw new Error(`getTasks: ${error.message}`);
  return (data as TaskRow[]).map(mapTask);
});
