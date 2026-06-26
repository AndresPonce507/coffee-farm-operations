"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleSlash, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { openMillingRunAction, recordMillReadinessAction } from "./actions";
import type { MillLotRow } from "./data";

/**
 * Spec-gate launcher — the ONE interactive island on /mill (the board stays a Server
 * Component). It drives the two-step keystone: (1) record a reposo/spec reading
 * (moisture + aw), then (2) open a milling run — which only unlocks once the reading
 * passes the gate (in-spec moisture + aw AND the lot is reposo-cleared). The disable
 * here is a UI courtesy; open_milling_run RAISES at the database if a passing reading
 * does not exist (the real wall). A human submits the form; nothing is driven by
 * untrusted inbound (rail §7). Milling consumes parchment, so no green inventory /
 * ATP moves — the board re-reads via router.refresh() after a run opens.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const MOISTURE_MIN = 10.5;
const MOISTURE_MAX = 11.5;
const AW_MAX = 0.6;

export function MillGate({ lots }: { lots: MillLotRow[] }) {
  const t = useTranslations("mill");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [lotCode, setLotCode] = useState<string>(
    lots[0]?.parchmentLotCode ?? "",
  );
  const [moistureStr, setMoistureStr] = useState("");
  const [awStr, setAwStr] = useState("");
  const [kgStr, setKgStr] = useState("");

  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  // A reading has been recorded AND it cleared the gate → the run section unlocks.
  const [cleared, setCleared] = useState(false);

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const selected = useMemo(
    () => lots.find((l) => l.parchmentLotCode === lotCode) ?? null,
    [lots, lotCode],
  );
  const reposoOk = selected?.reposoReady === true;

  const moisture = moistureStr.trim() === "" ? null : Number(moistureStr);
  const aw = awStr.trim() === "" ? null : Number(awStr);

  const inSpec =
    moisture != null &&
    Number.isFinite(moisture) &&
    moisture >= MOISTURE_MIN &&
    moisture <= MOISTURE_MAX &&
    aw != null &&
    Number.isFinite(aw) &&
    aw < AW_MAX;
  // The local mirror of the DB's GENERATED `passed`: in-spec AND reposo-cleared.
  const willPass = inSpec && reposoOk;

  const hasReading =
    moisture != null &&
    Number.isFinite(moisture) &&
    aw != null &&
    Number.isFinite(aw);

  function resetForLot(code: string) {
    setLotCode(code);
    setMoistureStr("");
    setAwStr("");
    setKgStr("");
    setRecordError(null);
    setOpenError(null);
    setCleared(false);
    setOpened(false);
  }

  async function onRecord() {
    if (!selected || moisture == null || aw == null) return;
    setRecordError(null);
    setRecording(true);
    const result = await recordMillReadinessAction({
      parchmentLotCode: selected.parchmentLotCode,
      moisturePct: moisture,
      waterActivityAw: aw,
      idempotencyKey: newKey(),
    });
    setRecording(false);
    if (!result.ok) {
      setRecordError(result.error);
      return;
    }
    // The reading saved. It unlocks the run only if it cleared the gate; otherwise
    // the operator re-measures (the no-mill-out-of-spec posture, told honestly).
    setCleared(willPass);
    router.refresh();
  }

  async function onOpenRun() {
    if (!selected) return;
    const kg = kgStr.trim() === "" ? null : Number(kgStr);
    if (kg == null || !Number.isFinite(kg) || kg <= 0) {
      setOpenError(t("errors.kgPositive"));
      return;
    }
    setOpenError(null);
    setOpening(true);
    const result = await openMillingRunAction({
      parchmentLotCode: selected.parchmentLotCode,
      parchmentKgIn: kg,
      idempotencyKey: newKey(),
    });
    setOpening(false);
    if (!result.ok) {
      setOpenError(result.error);
      return;
    }
    setOpened(true);
    router.refresh();
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <FlaskConical className="h-4 w-4" aria-hidden />
        {t("gate.open")}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("gate.title")}>
        {lots.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("gate.noLots")}</p>
        ) : opened ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-forest">
              {t("gate.opened")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("gate.cancel")}
              </Button>
              <Button type="button" onClick={() => resetForLot(lotCode)}>
                {t("gate.another")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* lot picker */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="mg-lot">
                {t("gate.lotLabel")}
              </label>
              <select
                id="mg-lot"
                className={FIELD}
                value={lotCode}
                onChange={(e) => resetForLot(e.target.value)}
              >
                {lots.map((l) => (
                  <option key={l.parchmentLotCode} value={l.parchmentLotCode}>
                    {l.parchmentLotCode}
                  </option>
                ))}
              </select>
            </div>

            {/* reposo clearance (read-only, the upstream gate) */}
            <div className="flex items-center gap-1.5 rounded-xl bg-paper/70 px-3 py-2">
              {reposoOk ? (
                <CheckCircle2 className="h-4 w-4 text-forest" aria-hidden />
              ) : (
                <CircleSlash className="h-4 w-4 text-muted-fg" aria-hidden />
              )}
              <div>
                <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                  {t("gate.reposoLabel")}
                </p>
                <p className="text-sm text-ink">
                  {reposoOk
                    ? t("gate.reposoReady")
                    : selected?.reposoReason ?? t("gate.reposoNotReady")}
                </p>
              </div>
            </div>

            {/* moisture + aw */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL} htmlFor="mg-moisture">
                  {t("gate.moistureLabel")}
                </label>
                <input
                  id="mg-moisture"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  inputMode="decimal"
                  className={FIELD}
                  value={moistureStr}
                  onChange={(e) => setMoistureStr(e.target.value)}
                />
                <p className="text-[0.6875rem] text-muted-fg">
                  {t("gate.moistureHint")}
                </p>
              </div>
              <div className="space-y-1">
                <label className={LABEL} htmlFor="mg-aw">
                  {t("gate.awLabel")}
                </label>
                <input
                  id="mg-aw"
                  type="number"
                  min={0}
                  max={1}
                  step="0.01"
                  inputMode="decimal"
                  className={FIELD}
                  value={awStr}
                  onChange={(e) => setAwStr(e.target.value)}
                />
                <p className="text-[0.6875rem] text-muted-fg">
                  {t("gate.awHint")}
                </p>
              </div>
            </div>

            {/* live gate preview */}
            {hasReading && (
              <p
                className={
                  "text-xs " +
                  (willPass ? "font-medium text-forest" : "text-muted-fg")
                }
              >
                {!reposoOk
                  ? t("gate.previewReposo")
                  : willPass
                    ? t("gate.previewPass")
                    : t("gate.previewFail")}
              </p>
            )}

            {recordError && (
              <p
                role="alert"
                className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
              >
                {recordError}
              </p>
            )}

            {/* Step 1 — record the reading */}
            {!cleared && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-fg">{t("gate.blockedNote")}</p>
                <Button
                  type="button"
                  disabled={recording || !hasReading}
                  onClick={onRecord}
                >
                  {recording ? t("gate.recording") : t("gate.record")}
                </Button>
              </div>
            )}

            {/* Step 2 — open the run (only once a reading cleared the gate) */}
            {cleared && (
              <div className="space-y-3 border-t border-line pt-3">
                <p className="text-xs font-medium text-forest">
                  {t("gate.recorded")}
                </p>
                <div className="space-y-1">
                  <label className={LABEL} htmlFor="mg-kg">
                    {t("gate.kgLabel")}
                  </label>
                  <input
                    id="mg-kg"
                    type="number"
                    min={0}
                    step="1"
                    inputMode="decimal"
                    className={FIELD}
                    value={kgStr}
                    onChange={(e) => setKgStr(e.target.value)}
                  />
                  <p className="text-[0.6875rem] text-muted-fg">
                    {t("gate.kgHint")}
                  </p>
                </div>

                {openError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
                  >
                    {openError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    {t("gate.cancel")}
                  </Button>
                  <Button
                    type="button"
                    disabled={opening || kgStr.trim() === ""}
                    onClick={onOpenRun}
                  >
                    {opening ? t("gate.opening") : t("gate.openRun")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
