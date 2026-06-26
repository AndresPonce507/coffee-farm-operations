"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Plot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createPlot, deletePlot, updatePlot } from "@/lib/actions/plots";
import { PlotForm } from "./plot-form";

export function AddPlotButton() {
  const t = useTranslations("plots");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("actions.newPlot")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("actions.newPlot")}>
        <PlotForm
          action={createPlot}
          submitLabel={t("actions.addPlot")}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function PlotRowActions({ plot }: { plot: Plot }) {
  const t = useTranslations("plots");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("actions.deleteConfirm", { name: plot.name }))
    ) {
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      const result = await deletePlot(plot.id);
      if (result.status === "error") {
        setDeleteError(result.message ?? t("actions.deleteFailed"));
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t("actions.editAria", { name: plot.name })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={t("actions.deleteAria", { name: plot.name })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {deleteError && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {deleteError}
        </p>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title={t("actions.editPlot")}>
        <PlotForm
          plot={plot}
          action={updatePlot}
          submitLabel={t("actions.saveChanges")}
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
