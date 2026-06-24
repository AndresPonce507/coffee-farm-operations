"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ProcessingBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  createBatch,
  deleteBatch,
  updateBatch,
} from "@/lib/actions/processing";
import { BatchForm } from "./batch-form";

export function AddBatchButton({ lots }: { lots: string[] }) {
  const t = useTranslations("processing");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("actions.newBatch")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("actions.newBatch")}
      >
        <BatchForm
          lots={lots}
          action={createBatch}
          submitLabel={t("actions.addBatch")}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function BatchRowActions({
  batch,
  lots,
}: {
  batch: ProcessingBatch;
  lots: string[];
}) {
  const t = useTranslations("processing");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("actions.deleteConfirm", { code: batch.lotCode }))
    ) {
      return;
    }
    startTransition(() => {
      void deleteBatch(batch.id);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t("actions.editAria", { code: batch.lotCode })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={t("actions.deleteAria", { code: batch.lotCode })}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-cherry/10 hover:text-cherry disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t("actions.editBatch")}
      >
        <BatchForm
          lots={lots}
          batch={batch}
          action={updateBatch}
          submitLabel={t("form.saveChanges")}
          onDone={() => setEditing(false)}
        />
      </Dialog>
    </div>
  );
}
