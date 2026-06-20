import type {
  FarmTask,
  Plot,
  Priority,
  TaskCategory,
  TaskStatus,
  Worker,
} from "@/lib/types";
import { getTasks } from "@/lib/db/tasks";
import { TaskRowActions } from "./task-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/data-table";
import { longDate, relativeDay } from "@/lib/utils";

/** Fixed "today" the mock data is anchored to (matches relativeDay default). */
const TODAY = "2026-06-20";

/** Category pills — each TaskCategory maps to a full, literal Badge tone. */
const CATEGORY_TONE: Record<TaskCategory, BadgeTone> = {
  Pruning: "coffee",
  Fertilizing: "honey",
  "Pest Control": "cherry",
  Weeding: "forest",
  Planting: "forest",
  Irrigation: "sky",
  Soil: "coffee",
};

/** Priority pills — high reads as danger, medium as warn, low as neutral. */
const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Status pills — done ok, in-progress sky, blocked danger, todo neutral. */
const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  done: "ok",
  "in-progress": "sky",
  blocked: "danger",
  todo: "neutral",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  done: "Done",
  "in-progress": "In progress",
  blocked: "Blocked",
  todo: "To do",
};

/** A task is overdue when its due date is before today and it is not finished. */
function isOverdue(task: FarmTask): boolean {
  if (task.status === "done") return false;
  return (
    new Date(task.due + "T00:00:00").getTime() <
    new Date(TODAY + "T00:00:00").getTime()
  );
}

/**
 * TaskTable — the full agronomy task board for Janson Coffee.
 * Server component (no hooks/handlers): renders every task with its category,
 * plot, assignee, due date, priority and status as on-brand badges.
 */
export async function TaskTable({
  plots,
  workers,
}: {
  plots: Plot[];
  workers: Worker[];
}) {
  const tasks = await getTasks();

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>All tasks</CardTitle>
          <CardDescription>
            {tasks.length} agronomy tasks across the farm — pruning, picking
            prep, soil &amp; pest work.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Table className="cv-auto">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Task</TH>
              <TH>Category</TH>
              <TH>Plot</TH>
              <TH>Assignee</TH>
              <TH>Due</TH>
              <TH>Priority</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {tasks.map((task) => {
              const overdue = isOverdue(task);
              return (
                <TR key={task.id}>
                  <TD className="max-w-[22rem] font-medium text-ink">
                    {task.title}
                  </TD>

                  <TD>
                    <Badge tone={CATEGORY_TONE[task.category]}>
                      {task.category}
                    </Badge>
                  </TD>

                  <TD className="whitespace-nowrap text-muted-fg">
                    {task.plotName ?? (
                      <span aria-hidden="true">—</span>
                    )}
                  </TD>

                  <TD>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={task.assignee} size="sm" />
                      <span className="text-ink">{task.assignee}</span>
                    </span>
                  </TD>

                  <TD className="whitespace-nowrap">
                    <span
                      className={
                        overdue ? "font-medium text-cherry" : "text-ink"
                      }
                    >
                      {longDate(task.due)}
                    </span>
                    <span
                      className={
                        overdue
                          ? "ml-2 text-xs text-cherry/80"
                          : "ml-2 text-xs text-muted-fg"
                      }
                    >
                      {relativeDay(task.due)}
                    </span>
                  </TD>

                  <TD>
                    <Badge tone={PRIORITY_TONE[task.priority]} dot>
                      {PRIORITY_LABEL[task.priority]}
                    </Badge>
                  </TD>

                  <TD>
                    <Badge tone={STATUS_TONE[task.status]} dot>
                      {STATUS_LABEL[task.status]}
                    </Badge>
                  </TD>

                  <TD className="text-right">
                    <TaskRowActions task={task} plots={plots} workers={workers} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
