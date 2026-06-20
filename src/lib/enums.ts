import type {
  AttendanceStatus,
  BatchStage,
  CoffeeVariety,
  PlotStatus,
  Priority,
  ProcessMethod,
  TaskCategory,
  TaskStatus,
  WorkerRole,
} from "@/lib/types";

/**
 * Runtime value lists for the DB/TS enums — the single source the write forms
 * (selects) and the Server Action validators share, so neither drifts from the
 * `coffee_variety`/`task_status`/… Postgres types or the `@/lib/types` unions.
 */
export const COFFEE_VARIETIES = [
  "Geisha",
  "Caturra",
  "Catuaí",
  "Pacamara",
  "Typica",
] as const satisfies readonly CoffeeVariety[];

export const PLOT_STATUSES = [
  "healthy",
  "watch",
  "at-risk",
] as const satisfies readonly PlotStatus[];

export const WORKER_ROLES = [
  "Picker",
  "Agronomist",
  "Mill Operator",
  "Supervisor",
  "Driver",
] as const satisfies readonly WorkerRole[];

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "rest-day",
] as const satisfies readonly AttendanceStatus[];

export const PROCESS_METHODS = [
  "Washed",
  "Natural",
  "Honey",
  "Anaerobic",
] as const satisfies readonly ProcessMethod[];

export const BATCH_STAGES = [
  "cherry",
  "fermentation",
  "drying",
  "parchment",
  "milled",
  "green",
] as const satisfies readonly BatchStage[];

export const TASK_CATEGORIES = [
  "Pruning",
  "Fertilizing",
  "Pest Control",
  "Weeding",
  "Planting",
  "Irrigation",
  "Soil",
] as const satisfies readonly TaskCategory[];

export const TASK_STATUSES = [
  "todo",
  "in-progress",
  "done",
  "blocked",
] as const satisfies readonly TaskStatus[];

export const PRIORITIES = [
  "low",
  "medium",
  "high",
] as const satisfies readonly Priority[];
