"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";

import type { FarmTask, Plot, Worker } from "@/lib/types";
import { PRIORITIES, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/enums";
import { IDLE, type ActionState } from "@/lib/actions/tasks";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

type TaskAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function TaskForm({
  plots,
  workers,
  task,
  action,
  submitLabel,
  onDone,
}: {
  plots: Plot[];
  workers: Worker[];
  task?: FarmTask;
  action: TaskAction;
  submitLabel: string;
  onDone: () => void;
}) {
  const t = useTranslations("tasks");
  const [state, formAction, pending] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // FarmTask carries the assignee NAME; resolve it back to the worker id to preselect.
  const assigneeId = task
    ? workers.find((w) => w.name === task.assignee)?.id
    : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {task && <input type="hidden" name="id" value={task.id} />}

      <div className="space-y-1">
        <label className={LABEL} htmlFor="title">
          {t("form.title")}
        </label>
        <input
          id="title"
          name="title"
          defaultValue={task?.title}
          placeholder={t("form.titlePlaceholder")}
          className={FIELD}
        />
        {fieldError("title") && (
          <p className="text-xs text-cherry">{fieldError("title")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="category">
            {t("form.category")}
          </label>
          <select id="category" name="category" defaultValue={task?.category ?? ""} className={FIELD}>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="priority">
            {t("form.priority")}
          </label>
          <select id="priority" name="priority" defaultValue={task?.priority ?? "medium"} className={FIELD}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="workerId">
            {t("form.assignee")}
          </label>
          <select id="workerId" name="workerId" defaultValue={assigneeId ?? ""} className={FIELD}>
            <option value="" disabled>
              {t("form.choose")}
            </option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="plotId">
            {t("form.plot")}
          </label>
          <select id="plotId" name="plotId" defaultValue={task?.plotId ?? ""} className={FIELD}>
            <option value="">{t("form.farmWide")}</option>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="due">
            {t("form.due")}
          </label>
          <input id="due" name="due" type="date" defaultValue={task?.due} className={FIELD} />
          {fieldError("due") && (
            <p className="text-xs text-cherry">{fieldError("due")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="status">
            {t("form.status")}
          </label>
          <select id="status" name="status" defaultValue={task?.status ?? "todo"} className={FIELD}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
