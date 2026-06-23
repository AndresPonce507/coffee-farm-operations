import {
  Scissors,
  Sprout,
  Bug,
  Wind,
  Trees,
  Droplets,
  Mountain,
  Cherry,
  HelpCircle,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { getTasks } from "@/lib/db/tasks";
import type { FarmTask, Priority, TaskCategory, TaskStatus } from "@/lib/types";
import { cn, relativeDay } from "@/lib/utils";

/* ---- Column definitions (status → display title), rendered left→right ---- */
const COLUMNS: ReadonlyArray<{ status: TaskStatus; title: string }> = [
  { status: "todo", title: "To do" },
  { status: "in-progress", title: "In progress" },
  { status: "blocked", title: "Blocked" },
  { status: "done", title: "Done" },
];

/* ---- Category → Badge tone (explicit literal map; no interpolation) ---- */
const CATEGORY_TONE: Record<TaskCategory, BadgeTone> = {
  Pruning: "forest",
  Fertilizing: "honey",
  "Pest Control": "cherry",
  Weeding: "sky",
  Planting: "ok",
  Irrigation: "sky",
  Soil: "coffee",
  Harvest: "cherry",
};

/* ---- Category → icon (typed lucide components) ---- */
type IconType = React.ComponentType<{ className?: string }>;
const CATEGORY_ICON: Record<TaskCategory, IconType> = {
  Pruning: Scissors,
  Fertilizing: Sprout,
  "Pest Control": Bug,
  Weeding: Wind,
  Planting: Trees,
  Irrigation: Droplets,
  Soil: Mountain,
  Harvest: Cherry,
};

/* ---- Priority → dot color (explicit literal map) ---- */
const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-cherry",
  medium: "bg-honey",
  low: "bg-muted-fg/40",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

/** Overdue = due before the fixed "today" (2026-06-20) AND not yet done. */
function isOverdue(task: FarmTask): boolean {
  return task.status !== "done" && task.due < "2026-06-20";
}

/* ---- A single task tile ---- */
function TaskTile({ task }: { task: FarmTask }) {
  // Total lookup: a future DB enum value the TS contract hasn't caught up to
  // must never render `undefined` (which throws and 500s the whole route).
  const Icon = CATEGORY_ICON[task.category] ?? HelpCircle;
  const overdue = isOverdue(task);

  return (
    <article className="glass-card glass-hover group rounded-2xl p-3.5">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <Badge tone={CATEGORY_TONE[task.category]}>
          <Icon className="h-3 w-3" />
          {task.category}
        </Badge>
        <span
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
          role="img"
          aria-label={PRIORITY_LABEL[task.priority]}
        />
      </div>

      <h4 className="text-sm font-medium leading-snug text-ink">{task.title}</h4>
      {task.plotName && (
        task.plotId ? (
          <EntityLink kind="plot" id={task.plotId} name={String(task.plotId)}>
            <p className="mt-1 text-xs text-muted-fg">{task.plotName}</p>
          </EntityLink>
        ) : (
          <p className="mt-1 text-xs text-muted-fg">{task.plotName}</p>
        )
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/60 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={task.assignee} size="sm" />
          {task.workerId ? (
            <EntityLink kind="worker" id={task.workerId} name={String(task.workerId)}>
              <span className="truncate text-xs font-medium text-ink">{task.assignee}</span>
            </EntityLink>
          ) : (
            <span className="truncate text-xs font-medium text-ink">{task.assignee}</span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-xs font-medium tabular-nums",
            overdue ? "text-cherry" : "text-muted-fg",
          )}
        >
          {relativeDay(task.due)}
        </span>
      </div>
    </article>
  );
}

/* ---- Kanban board: the centerpiece of the tasks page ---- */
export async function TaskBoard() {
  const tasks = await getTasks();

  return (
    <section className="animate-rise cv-auto" aria-label="Task board by status">
      <div className="perf-contain grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map(({ status, title }) => {
          const columnTasks = tasks.filter((t) => t.status === status);

          return (
            <div
              key={status}
              className="glass-card flex flex-col rounded-2xl p-3"
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
                <span className="grid h-6 min-w-6 place-items-center rounded-full border border-white/60 bg-white/55 px-2 text-xs font-semibold text-muted-fg">
                  {columnTasks.length}
                </span>
              </header>

              <div className="stagger flex flex-col gap-2.5">
                {columnTasks.length > 0 ? (
                  columnTasks.map((task) => <TaskTile key={task.id} task={task} />)
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted-fg">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
