"use client";

import { useActionState, useEffect } from "react";

import type { Harvest, Plot, Worker } from "@/lib/types";
import { IDLE, type ActionState } from "@/lib/actions/harvests";
import { Button } from "@/components/ui/button";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

type HarvestAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function HarvestForm({
  plots,
  pickers,
  lots,
  harvest,
  action,
  submitLabel,
  onDone,
}: {
  plots: Plot[];
  pickers: Worker[];
  lots: string[];
  harvest?: Harvest;
  action: HarvestAction;
  submitLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // Harvest carries the picker NAME; resolve it back to the worker id to preselect.
  const pickerId = harvest
    ? pickers.find((w) => w.name === harvest.picker)?.id
    : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {harvest && <input type="hidden" name="id" value={harvest.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="date">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={harvest?.date}
            className={FIELD}
          />
          {fieldError("date") && (
            <p className="text-xs text-cherry">{fieldError("date")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="lotCode">
            Lot
          </label>
          <select
            id="lotCode"
            name="lotCode"
            defaultValue={harvest?.lotCode ?? ""}
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="plotId">
            Plot
          </label>
          <select
            id="plotId"
            name="plotId"
            defaultValue={harvest?.plotId ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {fieldError("plotId") && (
            <p className="text-xs text-cherry">{fieldError("plotId")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="workerId">
            Picker
          </label>
          <select
            id="workerId"
            name="workerId"
            defaultValue={pickerId ?? ""}
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            {pickers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {fieldError("workerId") && (
            <p className="text-xs text-cherry">{fieldError("workerId")}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="cherriesKg">
            Cherries (kg)
          </label>
          <input
            id="cherriesKg"
            name="cherriesKg"
            type="number"
            min="0"
            step="0.1"
            defaultValue={harvest?.cherriesKg}
            className={FIELD}
          />
          {fieldError("cherriesKg") && (
            <p className="text-xs text-cherry">{fieldError("cherriesKg")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="ripenessPct">
            Ripeness %
          </label>
          <input
            id="ripenessPct"
            name="ripenessPct"
            type="number"
            min="0"
            max="100"
            defaultValue={harvest?.ripenessPct}
            className={FIELD}
          />
          {fieldError("ripenessPct") && (
            <p className="text-xs text-cherry">{fieldError("ripenessPct")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="brixAvg">
            Brix
          </label>
          <input
            id="brixAvg"
            name="brixAvg"
            type="number"
            min="0"
            step="0.1"
            defaultValue={harvest?.brixAvg}
            className={FIELD}
          />
          {fieldError("brixAvg") && (
            <p className="text-xs text-cherry">{fieldError("brixAvg")}</p>
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
