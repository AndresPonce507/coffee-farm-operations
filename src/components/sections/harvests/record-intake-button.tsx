"use client";

import { useState } from "react";
import { Sprout } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Plot, Worker } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CherryIntakeForm } from "./cherry-intake-form";

/**
 * RecordIntakeButton — the primary affordance for the cherry-intake genesis
 * WRITE. Distinct from the simple "Log harvest" path (which appends a `harvests`
 * row): this mints a system-numbered, traceable JC-NNN lot through the
 * `record_cherry_intake` RPC — the canonical record COGS / EUDR / inventory read.
 *
 * The button opens the glass `Dialog`, which hosts `CherryIntakeForm`; on a
 * successful mint the form swaps to its own success state (with the lot link),
 * so the dialog stays open for the family to follow through to the lot.
 */
export function RecordIntakeButton({
  plots,
  pickers,
}: {
  plots: Plot[];
  pickers: Worker[];
}) {
  const t = useTranslations("harvests");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Sprout className="h-4 w-4" aria-hidden />
        {t("recordIntakeButton.label")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("recordIntakeButton.dialogTitle")}
      >
        <CherryIntakeForm
          plots={plots}
          pickers={pickers}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
