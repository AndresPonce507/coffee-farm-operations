"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Lock, MoveRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { BatchStage } from "@/lib/types";
import { BATCH_STAGES } from "@/lib/enums";
import {
  advanceStageAction,
  PROCESSING_IDLE,
  type ProcessingActionState,
} from "@/app/(app)/processing/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn, kg } from "@/lib/utils";

/**
 * AdvanceStageControl — the client island that MOVES a lot forward through the
 * pipeline from the Processing surface (the first interactive write on this
 * route; everything else is a Server Component).
 *
 * COHERENCE (pipeline-UI review fix): the control is keyed off the LOT, not a
 * batch row. The advance write moves `lots.stage` / `lots.current_kg`, so the
 * board reads the LOT's stage (`getLotStages`) and renders exactly ONE advance
 * affordance per `lot_code` with that stage as the "from". This removes the old
 * defect where a lot_code with several `processing_batches` rows showed several
 * Advance buttons all mutating one shared lot, and where the displayed "from"
 * stage came from the stale `processing_batches.stage` column.
 *
 * It is a thin trigger that opens a glass dialog carrying the advance form,
 * driven by `advanceStageAction` through `useActionState`. The forward-only
 * model is enforced in the database (the hardened `advance_processing_stage`
 * RPC forbids a backward move and a mass GAIN); this island mirrors that as UI
 * guidance — two belts on top of the DB's braces:
 *   1. It only offers stages AFTER the lot's current stage, defaulting to the
 *      immediate next one, and a green (finished) lot shows no trigger at all —
 *      the UI never even attempts a move the DB would reject.
 *   2. If the RPC DOES reject (e.g. a typed-in weight that gained mass), the
 *      action returns a clean, family-readable message which we surface as an
 *      on-brand inline alert — never a raw Postgres exception.
 *
 * A STABLE idempotency key is generated per open form instance (a hidden field)
 * so a double-submit forwards the SAME key — the DB dedupes it to a no-op rather
 * than appending a duplicate ledger event.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

/** The stages strictly AFTER `stage` in pipeline order (the legal forward set). */
function forwardStages(stage: BatchStage): BatchStage[] {
  const i = BATCH_STAGES.indexOf(stage);
  return BATCH_STAGES.slice(i + 1) as BatchStage[];
}

/**
 * The advance affordance for a single LOT. `currentStage` is the LOT's
 * authoritative stage (`lots.stage`, surfaced by `getLotStages`) — the "from" —
 * and `currentKg` its mass at that stage. The board renders exactly one of these
 * per `lot_code`.
 */
export function AdvanceStageControl({
  lotCode,
  currentStage,
  currentKg,
}: {
  lotCode: string;
  currentStage: BatchStage;
  currentKg: number;
}) {
  const t = useTranslations("processing");
  const [open, setOpen] = useState(false);
  const ahead = forwardStages(currentStage);

  // A finished (green) lot — or any lot already at the pipeline terminal — has
  // nowhere forward to go, so it shows no trigger at all.
  if (ahead.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t("advance.triggerAria", { code: lotCode })}
      >
        <MoveRight className="h-3.5 w-3.5" />
        {t("advance.advance")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("advance.dialogTitle", { code: lotCode })}
      >
        <AdvanceForm
          lotCode={lotCode}
          currentStage={currentStage}
          currentKg={currentKg}
          forward={ahead}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function AdvanceForm({
  lotCode,
  currentStage,
  currentKg,
  forward,
  onDone,
}: {
  lotCode: string;
  currentStage: BatchStage;
  currentKg: number;
  forward: BatchStage[];
  onDone: () => void;
}) {
  const t = useTranslations("processing");
  const [state, formAction, pending] = useActionState<
    ProcessingActionState,
    FormData
  >(advanceStageAction, PROCESSING_IDLE);

  // A STABLE idempotency key per open form instance: re-submitting the SAME form
  // forwards the SAME key, so the DB dedupes a double-submit to a no-op instead
  // of appending a duplicate ledger event. `useMemo` (empty deps) holds it for
  // the life of this mounted form — a fresh dialog open mounts a fresh key.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // A successful advance closes the dialog shortly after (the page revalidates
  // server-side, so the board reflects the new stage on the next paint).
  useEffect(() => {
    if (state.status === "success") {
      const timer = setTimeout(onDone, 700);
      return () => clearTimeout(timer);
    }
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // The hardened-RPC rejection (backward / mass-gain / bad stage) arrives here as
  // a clean message — rendered as an on-brand alert, never a raw exception.
  const errorMessage =
    state.status === "error" && state.message ? state.message : null;

  const nextStage = forward[0];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="lotCode" value={lotCode} />
      {/* Stable per-form idempotency key — a double-submit is a DB no-op. */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {/* From → To context so the family reads the move at a glance. */}
      <div className="flex items-center justify-center gap-3 rounded-xl border border-white/60 bg-white/55 px-4 py-3">
        <span className="rounded-lg bg-white/70 px-2.5 py-1 text-xs font-medium text-muted-fg">
          {t(`stages.${currentStage}`)}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-forest-500" aria-hidden />
        <span className="rounded-lg bg-forest-100 px-2.5 py-1 text-xs font-semibold text-forest-700">
          {t(`stages.${nextStage}`)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="advance-stage">
            {t("advance.moveToStage")}
          </label>
          <select
            id="advance-stage"
            name="toStage"
            defaultValue={nextStage}
            className={FIELD}
          >
            {forward.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </select>
          {fieldError("toStage") && (
            <p className="text-xs text-cherry">{fieldError("toStage")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="advance-kg">
            {t("advance.weightAfter")}
          </label>
          <input
            id="advance-kg"
            name="currentKg"
            type="number"
            min="0"
            max={currentKg}
            step="any"
            required
            defaultValue={currentKg}
            className={FIELD}
          />
          {fieldError("currentKg") && (
            <p className="text-xs text-cherry">{fieldError("currentKg")}</p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-fg">
        {t("advance.massHint", { weight: kg(currentKg) })}
      </p>

      {/* Friendly RPC rejection (forward-only / no mass-gain) as an inline alert. */}
      {errorMessage && (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
            "text-sm font-medium text-cherry",
          )}
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {state.status === "success" && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-xl border border-forest-300 bg-forest-100/95 px-4 py-3",
            "text-sm font-medium text-forest-700",
          )}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-forest" />
          {state.message ?? t("advance.lotAdvanced")}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("advance.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("advance.advancing") : t("advance.advanceLot")}
        </Button>
      </div>
    </form>
  );
}
