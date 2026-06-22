import type { Priority, TaskCategory, TaskStatus } from "@/lib/types";
import { PRIORITIES, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/enums";
import {
  isISODate,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

export interface TaskInput {
  title: string;
  category: TaskCategory;
  plotId: string | null;
  workerId: string;
  due: string;
  status: TaskStatus;
  priority: Priority;
}

/** Pure validation — mirrors the DB constraints so errors surface before the round-trip. */
export function validateTask(
  raw: Record<string, unknown>,
): ValidationResult<TaskInput> {
  const errors: Record<string, string> = {};

  const title = trimmed(raw.title);
  if (!title) errors.title = "Title is required.";

  const category = trimmed(raw.category) as TaskCategory;
  // `Harvest` is a system-fired category (the pasada scheduler), never a valid
  // form choice — so the form's accepted set stays TASK_CATEGORIES and a
  // submitted `Harvest` is correctly rejected here. The widening cast only lets
  // the wider TaskCategory be checked against the narrower form list.
  if (!(TASK_CATEGORIES as readonly string[]).includes(category))
    errors.category = "Choose a category.";

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose an assignee.";

  const due = trimmed(raw.due);
  if (!isISODate(due)) errors.due = "Choose a due date.";

  const status = trimmed(raw.status) as TaskStatus;
  if (!TASK_STATUSES.includes(status)) errors.status = "Choose a status.";

  const priority = trimmed(raw.priority) as Priority;
  if (!PRIORITIES.includes(priority)) errors.priority = "Choose a priority.";

  const plotRaw = trimmed(raw.plotId);
  const plotId = plotRaw === "" ? null : plotRaw;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { title, category, plotId, workerId, due, status, priority },
  };
}
