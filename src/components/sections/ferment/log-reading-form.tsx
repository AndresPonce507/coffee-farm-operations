"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, FlaskConical } from "lucide-react";

import {
  FERMENT_IDLE,
  recordFermentReadingAction,
  type FermentActionState,
} from "@/app/(app)/ferment/actions";
import { Button } from "@/components/ui/button";

/**
 * LogReadingForm — the big "log reading" control on a ferment batch (P2-S3). The ONE
 * interactive surface that grows the live curve: a kind picker (pH / temp / Brix) and a
 * value input, driven by the `recordFermentReadingAction` Server Action through
 * `useActionState`. Manual taps now; a BLE pH/temp probe is a drop-in later behind the
 * same write door. Glove-friendly tap targets, inline friendly errors (the SQL CHECK is
 * the real guard), a stable idempotency key so a double-submit dedupes to one reading.
 */

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function LogReadingForm({ batchId }: { batchId: string }) {
  const [state, formAction, pending] = useActionState<
    FermentActionState,
    FormData
  >(recordFermentReadingAction, FERMENT_IDLE);

  // Stable exactly-once anchor minted once per mount; carried as a hidden field so a
  // double-submit re-uses the SAME key (the RPC short-circuits on idempotency_key).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="reading-kind">
            Kind
          </label>
          <select
            id="reading-kind"
            name="kind"
            defaultValue="ph"
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("kind") ? true : undefined}
          >
            <option value="ph">pH</option>
            <option value="temp">Temp °C</option>
            <option value="brix">Brix °Bx</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="reading-value">
            Reading value
          </label>
          <input
            id="reading-value"
            name="value"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="e.g. 4.8"
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("value") ? true : undefined}
          />
          {fieldError("value") && (
            <p className="text-xs text-cherry">{fieldError("value")}</p>
          )}
        </div>
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {state.status === "success" ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-forest-700"
          >
            <CheckCircle2 className="h-4 w-4 text-forest" aria-hidden />
            {state.message}
          </span>
        ) : (
          <span aria-hidden />
        )}
        <Button type="submit" disabled={pending}>
          <FlaskConical className="h-4 w-4" aria-hidden />
          {pending ? "Logging…" : "Log reading"}
        </Button>
      </div>
    </form>
  );
}
