"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD, LABEL } from "@/components/ui/form-field";
import { num } from "@/lib/utils";
import type { AllocatableLot, SubStatus } from "./data";
import {
  allocateSubscriptionCycleAction,
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  recordDunningAction,
  resumeSubscriptionAction,
  skipSubscriptionCycleAction,
  type DunningStage,
} from "./actions";

/**
 * The ONE interactive island in /subscriptions (the board stays a Server Component).
 * It drives the Reserve Club lifecycle for one subscription:
 *   • Pause / Resume   — a flip, appended as a sub_event.
 *   • Skip a cycle     — one delivery skipped, subscription stays active.
 *   • Allocate a cycle — THE money-shaped, human-confirmed write: it reserves kg
 *     against a green lot (the EXISTING prevent_oversell trigger is the wall), and the
 *     confirm shows the ATP drop live before committing — a scarce micro-lot can never
 *     be promised twice.
 *   • Log dunning      — a failed-payment follow-up; a final step marks past_due.
 *   • Cancel           — ends the box; existing allocations stay on the books.
 *
 * Every write is fired by a human here (rail §7: no untrusted inbound drives it). On
 * success the island calls router.refresh() so the server board re-reads the moved
 * rows. Errors surface verbatim from the action (author-written guard copy) in an
 * assertive alert — never a raw SQLSTATE.
 */

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

const STAGES: DunningStage[] = ["soft", "reminder", "final"];
const STAGE_KEY: Record<DunningStage, string> = {
  soft: "stageSoft",
  reminder: "stageReminder",
  final: "stageFinal",
};

export function SubscriptionControls({
  subscriptionId,
  status,
  customerLabel,
  lots,
}: {
  subscriptionId: number;
  status: SubStatus;
  customerLabel: string;
  lots: AllocatableLot[];
}) {
  const t = useTranslations("subscriptions");
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type Modal = "allocate" | "skip" | "dunning" | "cancel" | null;
  const [modal, setModal] = useState<Modal>(null);

  // allocate form
  const [lotCode, setLotCode] = useState<string>(lots[0]?.greenLotCode ?? "");
  const [kgStr, setKgStr] = useState<string>("");
  const [allocCycle, setAllocCycle] = useState<string>("");
  // skip form
  const [skipCycle, setSkipCycle] = useState<string>("");
  // dunning form
  const [stage, setStage] = useState<DunningStage>("soft");

  const selectedLot = useMemo(
    () => lots.find((l) => l.greenLotCode === lotCode) ?? null,
    [lots, lotCode],
  );
  const kg = kgStr.trim() === "" ? NaN : Number(kgStr);
  const atpBefore = selectedLot?.atpKg ?? 0;
  const atpAfter = Number.isFinite(kg)
    ? Math.max(0, atpBefore - kg)
    : atpBefore;

  function openModal(m: Modal) {
    setError(null);
    setModal(m);
  }
  function close() {
    setModal(null);
    setError(null);
  }

  async function run<T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T>,
  ) {
    setError(null);
    setPending(true);
    const result = await fn();
    setPending(false);
    if (result.ok) {
      close();
      router.refresh();
    } else {
      setError(result.error ?? t("errors.generic"));
    }
  }

  const onPause = () =>
    run(() => pauseSubscriptionAction({ subscriptionId, idempotencyKey: newKey() }));
  const onResume = () =>
    run(() => resumeSubscriptionAction({ subscriptionId, idempotencyKey: newKey() }));
  const onCancel = () =>
    run(() => cancelSubscriptionAction({ subscriptionId, idempotencyKey: newKey() }));
  const onSkip = () =>
    run(() =>
      skipSubscriptionCycleAction({
        subscriptionId,
        cycleLabel: skipCycle.trim(),
        idempotencyKey: newKey(),
      }),
    );
  const onDunning = () =>
    run(() =>
      recordDunningAction({ subscriptionId, stage, idempotencyKey: newKey() }),
    );
  const onAllocate = () =>
    run(() =>
      allocateSubscriptionCycleAction({
        subscriptionId,
        greenLotCode: lotCode.trim(),
        kg,
        cycleLabel: allocCycle.trim(),
        idempotencyKey: newKey(),
      }),
    );

  if (status === "cancelled") {
    return (
      <p className="text-xs text-muted-fg">{t("status.cancelled")}</p>
    );
  }

  const alert = error ? (
    <p
      role="alert"
      className="mt-1 rounded-lg bg-cherry/10 px-3 py-2 text-xs text-cherry"
    >
      {error}
    </p>
  ) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "active" ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onPause}>
          {t("controls.pause")}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onResume}>
          {t("controls.resume")}
        </Button>
      )}

      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={pending || lots.length === 0}
        onClick={() => openModal("allocate")}
      >
        {t("controls.allocate")}
      </Button>

      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openModal("skip")}>
        {t("controls.skip")}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openModal("dunning")}>
        {t("controls.dunning")}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openModal("cancel")}>
        {t("controls.cancel")}
      </Button>

      {/* Allocate — the money-shaped, human-confirmed write with the live ATP drop. */}
      <Dialog open={modal === "allocate"} onClose={close} title={t("controls.allocateTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {t("controls.allocateBody", { cust: customerLabel })}
          </p>

          <div className="space-y-1">
            <label className={LABEL} htmlFor={`alloc-lot-${subscriptionId}`}>
              {t("controls.lotLabel")}
            </label>
            <select
              id={`alloc-lot-${subscriptionId}`}
              className={FIELD}
              value={lotCode}
              onChange={(e) => setLotCode(e.target.value)}
            >
              {lots.length === 0 && (
                <option value="">{t("controls.lotPlaceholder")}</option>
              )}
              {lots.map((l) => (
                <option key={l.greenLotCode} value={l.greenLotCode}>
                  {t("controls.lotOption", {
                    code: l.greenLotCode,
                    atp: num(Math.round(l.atpKg)),
                  })}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`alloc-kg-${subscriptionId}`}>
                {t("controls.kgLabel")}
              </label>
              <input
                id={`alloc-kg-${subscriptionId}`}
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                className={FIELD}
                value={kgStr}
                onChange={(e) => setKgStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL} htmlFor={`alloc-cycle-${subscriptionId}`}>
                {t("controls.cycleLabel")}
              </label>
              <input
                id={`alloc-cycle-${subscriptionId}`}
                type="text"
                className={FIELD}
                placeholder={t("controls.cyclePlaceholder")}
                value={allocCycle}
                onChange={(e) => setAllocCycle(e.target.value)}
              />
            </div>
          </div>

          {/* Live ATP drop — the scarce-lot money guarantee, shown before committing. */}
          <div className="flex items-center justify-between rounded-xl bg-paper/70 px-3 py-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("controls.atpBefore")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-ink">
                {num(Math.round(atpBefore))}
              </p>
            </div>
            <span aria-hidden className="text-muted-fg">→</span>
            <div className="text-right">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
                {t("controls.atpAfter")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-forest">
                {num(Math.round(atpAfter))}
              </p>
              <p className="text-[0.625rem] text-muted-fg">{t("controls.atpUnit")}</p>
            </div>
          </div>

          <p className="text-xs text-muted-fg">{t("controls.irreversible")}</p>
          {alert}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={close}>
              {t("controls.allocateCancel")}
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                lotCode.trim() === "" ||
                allocCycle.trim() === "" ||
                !(Number.isFinite(kg) && kg > 0)
              }
              onClick={onAllocate}
            >
              {pending ? t("controls.allocating") : t("controls.allocateConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Skip a cycle */}
      <Dialog open={modal === "skip"} onClose={close} title={t("controls.skipTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-ink">{t("controls.skipBody", { cust: customerLabel })}</p>
          <div className="space-y-1">
            <label className={LABEL} htmlFor={`skip-cycle-${subscriptionId}`}>
              {t("controls.skipCycleLabel")}
            </label>
            <input
              id={`skip-cycle-${subscriptionId}`}
              type="text"
              className={FIELD}
              placeholder={t("controls.cyclePlaceholder")}
              value={skipCycle}
              onChange={(e) => setSkipCycle(e.target.value)}
            />
          </div>
          {alert}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={close}>
              {t("controls.skipCancel")}
            </Button>
            <Button type="button" disabled={pending || skipCycle.trim() === ""} onClick={onSkip}>
              {pending ? t("controls.skipping") : t("controls.skipConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Log dunning */}
      <Dialog open={modal === "dunning"} onClose={close} title={t("controls.dunningTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-ink">{t("controls.dunningBody", { cust: customerLabel })}</p>
          <div className="space-y-1">
            <label className={LABEL} htmlFor={`dun-stage-${subscriptionId}`}>
              {t("controls.stageLabel")}
            </label>
            <select
              id={`dun-stage-${subscriptionId}`}
              className={FIELD}
              value={stage}
              onChange={(e) => setStage(e.target.value as DunningStage)}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`controls.${STAGE_KEY[s]}`)}
                </option>
              ))}
            </select>
          </div>
          {alert}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={close}>
              {t("controls.dunningCancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={onDunning}>
              {pending ? t("controls.dunningSaving") : t("controls.dunningConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Cancel — confirm before ending the box */}
      <Dialog open={modal === "cancel"} onClose={close} title={t("controls.cancelTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-ink">{t("controls.cancelBody", { cust: customerLabel })}</p>
          {alert}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={close}>
              {t("controls.cancelKeep")}
            </Button>
            <Button type="button" disabled={pending} onClick={onCancel}>
              {pending ? t("controls.cancelling") : t("controls.cancelConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
