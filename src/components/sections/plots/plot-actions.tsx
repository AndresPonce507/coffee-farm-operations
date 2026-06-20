"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { Plot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createPlot, deletePlot, updatePlot } from "@/lib/actions/plots";
import { PlotForm } from "./plot-form";

export function AddPlotButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New plot
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New plot">
        <PlotForm
          action={createPlot}
          submitLabel="Add plot"
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function PlotRowActions({ plot }: { plot: Plot }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${plot.name}"?`)
    ) {
      return;
    }
    startTransition(() => {
      void deletePlot(plot.id);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${plot.name}`}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete ${plot.name}`}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit plot">
        <PlotForm
          plot={plot}
          action={updatePlot}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
