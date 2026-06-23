import type {
  FarmTask,
  Plot,
  Priority,
  TaskCategory,
  TaskStatus,
  Worker,
} from "@/lib/types";
import { getTranslations } from "next-intl/server";

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
import { EntityLink } from "@/components/ui/entity-link";
import { longDate, relativeDay, today } from "@/lib/utils";

/** Category pills — each TaskCategory maps to a full, literal Badge tone. */
const CATEGORY_TONE: Record<TaskCategory, BadgeTone> = {
  Pruning: "coffee",
  Fertilizing: "honey",
  "Pest Control": "cherry",
  Weeding: "forest",
  Planting: "forest",
  Irrigation: "sky",
  Soil: "coffee",
  Harvest: "cherry",
};

/** Priority pills — high reads as danger, medium as warn, low as neutral. */
const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

const PRIORITY_LABEL_KEY: Record<Priority, string> = {
  high: "table.priorityHigh",
  medium: "table.priorityMedium",
  low: "table.priorityLow",
};

/** Status pills — done ok, in-progress sky, blocked danger, todo neutral. */
const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  done: "ok",
  "in-progress": "sky",
  blocked: "danger",
  todo: "neutral",
};

const STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  done: "table.statusDone",
  "in-progress": "table.statusInProgress",
  blocked: "table.statusBlocked",
  todo: "table.statusTodo",
};

/** A task is overdue when its due date is before today and it is not finished. */
function isOverdue(task: FarmTask): boolean {
  if (task.status === "done") return false;
  return (
    new Date(task.due + "T00:00:00").getTime() <
    new Date(today() + "T00:00:00").getTime()
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
  const t = await getTranslations("tasks");
  const tasks = await getTasks();

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>{t("table.title")}</CardTitle>
          <CardDescription>
            {t("table.description", { count: tasks.length })}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Table className="cv-auto">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t("table.task")}</TH>
              <TH>{t("table.category")}</TH>
              <TH>{t("table.plot")}</TH>
              <TH>{t("table.assignee")}</TH>
              <TH>{t("table.due")}</TH>
              <TH>{t("table.priority")}</TH>
              <TH>{t("table.status")}</TH>
              <TH className="text-right">{t("table.actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {tasks.length === 0 && (
              <TR className="hover:bg-transparent">
                <TD colSpan={8} className="px-4 py-10 text-center">
                  <span className="inline-block rounded-xl border border-dashed border-line bg-white/40 px-4 py-3 text-sm text-muted-fg">
                    {t("table.noTasks")}
                  </span>
                </TD>
              </TR>
            )}
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
                    {task.plotId != null ? (
                      <EntityLink
                        kind="plot"
                        id={task.plotId}
                        name={task.plotName ?? undefined}
                        className="text-muted-fg underline-offset-2 transition-colors hover:text-forest hover:underline"
                      >
                        {task.plotName}
                      </EntityLink>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </TD>

                  <TD>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={task.assignee} size="sm" />
                      {task.workerId != null ? (
                        <EntityLink
                          kind="worker"
                          id={task.workerId}
                          name={task.assignee ?? undefined}
                          className="text-ink underline-offset-2 transition-colors hover:text-forest hover:underline"
                        >
                          {task.assignee}
                        </EntityLink>
                      ) : (
                        <span className="text-ink">{task.assignee}</span>
                      )}
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
                          ? "ml-2 text-xs text-cherry"
                          : "ml-2 text-xs text-muted-fg"
                      }
                    >
                      {relativeDay(task.due)}
                    </span>
                  </TD>

                  <TD>
                    <Badge tone={PRIORITY_TONE[task.priority]} dot>
                      {t(PRIORITY_LABEL_KEY[task.priority])}
                    </Badge>
                  </TD>

                  <TD>
                    <Badge tone={STATUS_TONE[task.status]} dot>
                      {t(STATUS_LABEL_KEY[task.status])}
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
