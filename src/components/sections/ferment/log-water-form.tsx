"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Droplets } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  FERMENT_IDLE,
  logMillWaterAction,
  type FermentActionState,
} from "@/app/(app)/ferment/actions";
import { Button } from "@/components/ui/button";

/**
 * LogWaterForm — the "registrar agua de molino" control on a ferment batch (P2-S3). The
 * twin of LogReadingForm for the eco-mill water draw: a single liters input driven by the
 * `logMillWaterAction` Server Action through `useActionState`, appending to the
 * water-per-kg ledger (the sustainability story behind the WaterChip). The SQL CHECK
 * (liters > 0) is the real guard; this surfaces friendly errors before the round-trip.
 * Carries a per-draw idempotency key: stable across one write so a same-render
 * double-submit dedupes, re-minted after each success so the next distinct draw is its
 * own exactly-once event (the water ledger never double-counts a draw).
 */

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function LogWaterForm({ batchId }: { batchId: string }) {
  const t = useTranslations("ferment");
  const [state, formAction, pending] = useActionState<
    FermentActionState,
    FormData
  >(logMillWaterAction, FERMENT_IDLE);

  // Exactly-once anchor carried as a hidden field. Stable across the re-renders of a
  // SINGLE write (a same-render double-submit re-uses it so the RPC short-circuits on
  // idempotency_key), yet FRESH for each new draw — the form stays mounted while a
  // worker logs draw after draw against the same live batch.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const prevStatus = useRef(state.status);
  useEffect(() => {
    // After a successful write, mint a fresh key so the NEXT distinct draw is its own
    // exactly-once event; a true double-submit (same render) keeps this key and still
    // dedupes in log_mill_water. Keyed on the success TRANSITION via prevStatus (not on
    // `state` identity) to avoid a regenerate loop.
    if (state.status === "success" && prevStatus.current !== "success") {
      setIdempotencyKey(crypto.randomUUID());
    }
    prevStatus.current = state.status;
  }, [state]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="space-y-1">
        <label className={LABEL} htmlFor="water-liters">
          {t("logWaterForm.litersLabel")}
        </label>
        <input
          id="water-liters"
          name="liters"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          placeholder={t("logWaterForm.litersPlaceholder")}
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("liters") ? true : undefined}
        />
        {fieldError("liters") && (
          <p className="text-xs text-cherry">{fieldError("liters")}</p>
        )}
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
          <Droplets className="h-4 w-4" aria-hidden />
          {pending ? t("logWaterForm.recording") : t("logWaterForm.recordWater")}
        </Button>
      </div>
    </form>
  );
}
