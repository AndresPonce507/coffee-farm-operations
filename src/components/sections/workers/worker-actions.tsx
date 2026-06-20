"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { Worker } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createWorker, deleteWorker, updateWorker } from "@/lib/actions/workers";
import { WorkerForm } from "./worker-form";

export function AddWorkerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New worker
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New worker">
        <WorkerForm
          action={createWorker}
          submitLabel="Add worker"
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function WorkerRowActions({ worker }: { worker: Worker }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${worker.name}"?`)
    ) {
      return;
    }
    startTransition(() => {
      void deleteWorker(worker.id);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${worker.name}`}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete ${worker.name}`}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit worker">
        <WorkerForm
          worker={worker}
          action={updateWorker}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
