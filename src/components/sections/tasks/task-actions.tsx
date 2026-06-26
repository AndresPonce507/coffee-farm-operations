"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { FarmTask, Plot, Worker } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createTask, deleteTask, updateTask } from "@/lib/actions/tasks";
import { TaskForm } from "./task-form";

export function AddTaskButton({
  plots,
  workers,
}: {
  plots: Plot[];
  workers: Worker[];
}) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("actions.newTask")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("actions.newTask")}>
        <TaskForm
          plots={plots}
          workers={workers}
          action={createTask}
          submitLabel={t("actions.addTask")}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function TaskRowActions({
  task,
  plots,
  workers,
}: {
  task: FarmTask;
  plots: Plot[];
  workers: Worker[];
}) {
  const t = useTranslations("tasks");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("actions.deleteConfirm", { title: task.title }))
    ) {
      return;
    }
    startTransition(() => {
      void deleteTask(task.id);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t("actions.editLabel", { title: task.title })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={t("actions.deleteLabel", { title: task.title })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t("actions.editTask")}>
        <TaskForm
          plots={plots}
          workers={workers}
          task={task}
          action={updateTask}
          submitLabel={t("actions.saveChanges")}
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
