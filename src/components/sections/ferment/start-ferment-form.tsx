"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import type { FermentRecipe } from "@/lib/db/ferment";
import { PROCESS_METHODS } from "@/lib/enums";
import {
  FERMENT_IDLE,
  startFermentBatchAction,
  type FermentActionState,
} from "@/app/(app)/ferment/actions";
import { Button } from "@/components/ui/button";

/**
 * StartFermentForm — opens a new ferment run on a lot, bound to a recipe VERSION
 * (P2-S3). Driven by `startFermentBatchAction` through `useActionState`. The recipe is
 * the SSOT the live curve is cut against; choosing it here binds the batch to the exact
 * altitude-tuned target forever. Method defaults to the recipe's method but stays
 * overridable. Stable idempotency key so a double-submit dedupes to one batch.
 */

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function StartFermentForm({
  lots,
  recipes,
  onDone,
}: {
  lots: string[];
  recipes: FermentRecipe[];
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    FermentActionState,
    FormData
  >(startFermentBatchAction, FERMENT_IDLE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // active (non-superseded) recipes first, for the picker.
  const live = recipes.filter((r) => r.supersededBy === null);
  const pickable = live.length > 0 ? live : recipes;

  if (state.status === "success") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm text-muted-fg">{state.message}</p>
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="space-y-1">
        <label className={LABEL} htmlFor="ferment-lot">
          Lot
        </label>
        <select
          id="ferment-lot"
          name="lotCode"
          defaultValue=""
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("lotCode") ? true : undefined}
        >
          <option value="" disabled>
            Choose a lot…
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="ferment-recipe">
            Recipe
          </label>
          <select
            id="ferment-recipe"
            name="recipeId"
            defaultValue=""
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("recipeId") ? true : undefined}
          >
            <option value="" disabled>
              Choose a recipe…
            </option>
            {pickable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · v{r.version}
              </option>
            ))}
          </select>
          {fieldError("recipeId") && (
            <p className="text-xs text-cherry">{fieldError("recipeId")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="ferment-method">
            Method
          </label>
          <select
            id="ferment-method"
            name="method"
            defaultValue="Anaerobic"
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("method") ? true : undefined}
          >
            {PROCESS_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {fieldError("method") && (
            <p className="text-xs text-cherry">{fieldError("method")}</p>
          )}
        </div>
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start ferment"}
        </Button>
      </div>
    </form>
  );
}
