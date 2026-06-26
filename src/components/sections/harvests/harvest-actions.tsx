"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Harvest, Plot, Worker } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  createHarvest,
  deleteHarvest,
  updateHarvest,
} from "@/lib/actions/harvests";
import { HarvestForm } from "./harvest-form";

export function AddHarvestButton({
  plots,
  pickers,
  lots,
}: {
  plots: Plot[];
  pickers: Worker[];
  lots: string[];
}) {
  const t = useTranslations("harvests");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("actions.logHarvest")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("actions.logHarvest")}>
        <HarvestForm
          plots={plots}
          pickers={pickers}
          lots={lots}
          action={createHarvest}
          submitLabel={t("actions.addHarvest")}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function HarvestRowActions({
  harvest,
  plots,
  pickers,
  lots,
}: {
  harvest: Harvest;
  plots: Plot[];
  pickers: Worker[];
  lots: string[];
}) {
  const t = useTranslations("harvests");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("actions.deleteConfirm", { code: harvest.lotCode }))
    ) {
      return;
    }
    startTransition(() => {
      void deleteHarvest(harvest.id);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t("actions.editHarvestLabel", { code: harvest.lotCode })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={t("actions.deleteHarvestLabel", { code: harvest.lotCode })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t("actions.editHarvest")}
      >
        <HarvestForm
          plots={plots}
          pickers={pickers}
          lots={lots}
          harvest={harvest}
          action={updateHarvest}
          submitLabel={t("actions.saveChanges")}
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
