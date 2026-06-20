"use client";

import { useActionState, useEffect } from "react";

import type { ProcessingBatch } from "@/lib/types";
import {
  BATCH_STAGES,
  COFFEE_VARIETIES,
  PROCESS_METHODS,
} from "@/lib/enums";
import { IDLE, type ActionState } from "@/lib/actions/processing";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

const STAGE_LABEL: Record<(typeof BATCH_STAGES)[number], string> = {
  cherry: "Cherry",
  fermentation: "Fermentation",
  drying: "Drying",
  parchment: "Parchment",
  milled: "Milled",
  green: "Green",
};

type BatchAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function BatchForm({
  lots,
  batch,
  action,
  submitLabel,
  onDone,
}: {
  lots: string[];
  batch?: ProcessingBatch;
  action: BatchAction;
  submitLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {batch && <input type="hidden" name="id" value={batch.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="lotCode">
            Lot
          </label>
          <select
            id="lotCode"
            name="lotCode"
            defaultValue={batch?.lotCode ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            {lots.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {fieldError("lotCode") && (
            <p className="text-xs text-cherry">{fieldError("lotCode")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="variety">
            Variety
          </label>
          <select
            id="variety"
            name="variety"
            defaultValue={batch?.variety ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            {COFFEE_VARIETIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="method">
            Method
          </label>
          <select
            id="method"
            name="method"
            defaultValue={batch?.method ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            {PROCESS_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="stage">
            Stage
          </label>
          <select
            id="stage"
            name="stage"
            defaultValue={batch?.stage ?? "cherry"}
            className={FIELD}
          >
            {BATCH_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="startedDate">
            Started
          </label>
          <input
            id="startedDate"
            name="startedDate"
            type="date"
            defaultValue={batch?.startedDate}
            className={FIELD}
          />
          {fieldError("startedDate") && (
            <p className="text-xs text-cherry">{fieldError("startedDate")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="patio">
            Patio / bed
          </label>
          <input
            id="patio"
            name="patio"
            defaultValue={batch?.patio}
            placeholder="e.g. Bed 7"
            className={FIELD}
          />
          {fieldError("patio") && (
            <p className="text-xs text-cherry">{fieldError("patio")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="cherriesKg">
            Cherry intake (kg)
          </label>
          <input
            id="cherriesKg"
            name="cherriesKg"
            type="number"
            min="0"
            step="any"
            defaultValue={batch?.cherriesKg}
            className={FIELD}
          />
          {fieldError("cherriesKg") && (
            <p className="text-xs text-cherry">{fieldError("cherriesKg")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="currentKg">
            Current weight (kg)
          </label>
          <input
            id="currentKg"
            name="currentKg"
            type="number"
            min="0"
            step="any"
            defaultValue={batch?.currentKg}
            className={FIELD}
          />
          {fieldError("currentKg") && (
            <p className="text-xs text-cherry">{fieldError("currentKg")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="moisturePct">
            Moisture (%)
          </label>
          <input
            id="moisturePct"
            name="moisturePct"
            type="number"
            min="0"
            max="100"
            step="any"
            defaultValue={batch?.moisturePct}
            className={FIELD}
          />
          {fieldError("moisturePct") && (
            <p className="text-xs text-cherry">{fieldError("moisturePct")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="progressPct">
            Progress (%)
          </label>
          <input
            id="progressPct"
            name="progressPct"
            type="number"
            min="0"
            max="100"
            step="1"
            defaultValue={batch?.progressPct}
            className={FIELD}
          />
          {fieldError("progressPct") && (
            <p className="text-xs text-cherry">{fieldError("progressPct")}</p>
          )}
        </div>
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
