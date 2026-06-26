"use client";

import { useState } from "react";
import { Droplets, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { StationOccupancy } from "@/lib/types";
import { RecordMoistureForm } from "./record-moisture-form";
import { AssignStationForm } from "./assign-station-form";

/**
 * DryingWriteActions — the two primary affordances for the drying surface: the
 * writes that FEED the reposo gate from the running app (review finding #54). Until
 * these existed, `/drying` was a read-only dashboard over data the family could
 * never author — no way to record a moisture reading or place a lot on a bed.
 *
 * Each button opens the shared portal-fixed glass `Dialog`, which hosts the
 * matching write form (record-moisture / assign-station). On a successful write the
 * form swaps to its own success state, so the dialog stays open for confirmation.
 */
export function DryingWriteActions({
  lots,
  stations,
}: {
  /** Lot codes currently resting (the gate's candidates). */
  lots: string[];
  /** Drying stations with their live committed-vs-capacity headroom. */
  stations: StationOccupancy[];
}) {
  const t = useTranslations("drying");
  const [recording, setRecording] = useState(false);
  const [assigning, setAssigning] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setAssigning(true)}>
        <MapPin className="h-4 w-4" aria-hidden />
        {t("writeActions.assignStation")}
      </Button>
      <Button variant="primary" onClick={() => setRecording(true)}>
        <Droplets className="h-4 w-4" aria-hidden />
        {t("writeActions.recordReading")}
      </Button>

      <Dialog
        open={recording}
        onClose={() => setRecording(false)}
        title={t("writeActions.recordDialogTitle")}
      >
        <RecordMoistureForm lots={lots} onDone={() => setRecording(false)} />
      </Dialog>

      <Dialog
        open={assigning}
        onClose={() => setAssigning(false)}
        title={t("writeActions.assignDialogTitle")}
      >
        <AssignStationForm
          lots={lots}
          stations={stations}
          onDone={() => setAssigning(false)}
        />
      </Dialog>
    </>
  );
}
