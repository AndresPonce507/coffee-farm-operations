"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Lock, MoveRight } from "lucide-react";

import type { BatchStage, ProcessingBatch } from "@/lib/types";
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
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

const STAGE_LABEL: Record<BatchStage, string> = {
  cherry: "Cherry",
  fermentation: "Fermentation",
  drying: "Drying",
  parchment: "Parchment",
  milled: "Milled",
  green: "Green",
};

/** The stages strictly AFTER `stage` in pipeline order (the legal forward set). */
function forwardStages(stage: BatchStage): BatchStage[] {
  const i = BATCH_STAGES.indexOf(stage);
  return BATCH_STAGES.slice(i + 1) as BatchStage[];
}

export function AdvanceStageControl({ batch }: { batch: ProcessingBatch }) {
  const [open, setOpen] = useState(false);
  const ahead = forwardStages(batch.stage);

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
        aria-label={`Advance ${batch.lotCode} to the next stage`}
      >
        <MoveRight className="h-3.5 w-3.5" />
        Advance
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Advance ${batch.lotCode}`}
      >
        <AdvanceForm
          batch={batch}
          forward={ahead}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function AdvanceForm({
  batch,
  forward,
  onDone,
}: {
  batch: ProcessingBatch;
  forward: BatchStage[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ProcessingActionState,
    FormData
  >(advanceStageAction, PROCESSING_IDLE);

  // A successful advance closes the dialog shortly after (the page revalidates
  // server-side, so the board reflects the new stage on the next paint).
  useEffect(() => {
    if (state.status === "success") {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
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
      <input type="hidden" name="lotCode" value={batch.lotCode} />

      {/* From → To context so the family reads the move at a glance. */}
      <div className="flex items-center justify-center gap-3 rounded-xl border border-white/60 bg-white/55 px-4 py-3">
        <span className="rounded-lg bg-white/70 px-2.5 py-1 text-xs font-medium text-muted-fg">
          {STAGE_LABEL[batch.stage]}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-forest-500" aria-hidden />
        <span className="rounded-lg bg-forest-100 px-2.5 py-1 text-xs font-semibold text-forest-700">
          {STAGE_LABEL[nextStage]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="advance-stage">
            Move to stage
          </label>
          <select
            id="advance-stage"
            name="toStage"
            defaultValue={nextStage}
            className={FIELD}
          >
            {forward.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          {fieldError("toStage") && (
            <p className="text-xs text-cherry">{fieldError("toStage")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="advance-kg">
            Weight after step (kg)
          </label>
          <input
            id="advance-kg"
            name="currentKg"
            type="number"
            min="0"
            max={batch.currentKg}
            step="any"
            defaultValue={batch.currentKg}
            className={FIELD}
          />
          {fieldError("currentKg") && (
            <p className="text-xs text-cherry">{fieldError("currentKg")}</p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-fg">
        Now at {kg(batch.currentKg)}. Processing conserves or loses mass — the new
        weight should be the same or lower.
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
          {state.message ?? "Lot advanced."}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Advancing…" : "Advance lot"}
        </Button>
      </div>
    </form>
  );
}
