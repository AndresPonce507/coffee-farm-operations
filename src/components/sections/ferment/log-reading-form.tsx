"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

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
 * the real guard), and a per-reading idempotency key: stable across one write so a
 * same-render double-submit dedupes, re-minted after each success so the next distinct
 * reading is its own exactly-once event (the curve never loses a reading).
 */

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function LogReadingForm({ batchId }: { batchId: string }) {
  const t = useTranslations("ferment");
  const [state, formAction, pending] = useActionState<
    FermentActionState,
    FormData
  >(recordFermentReadingAction, FERMENT_IDLE);

  // Exactly-once anchor carried as a hidden field. It must be STABLE across the
  // re-renders of a SINGLE write (a same-render double-submit re-uses it so the RPC
  // short-circuits on idempotency_key), yet FRESH for each new reading — the form
  // stays mounted while a picker logs reading after reading on the live curve.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const prevStatus = useRef(state.status);
  useEffect(() => {
    // After a successful write, mint a fresh key so the NEXT distinct reading is its
    // own exactly-once event; a true double-submit (same render) keeps this key and
    // still dedupes in record_ferment_reading. Keyed on the success TRANSITION via
    // prevStatus (not on `state` identity) to avoid a regenerate loop.
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

      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="reading-kind">
            {t("logReadingForm.kindLabel")}
          </label>
          <select
            id="reading-kind"
            name="kind"
            defaultValue="ph"
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("kind") ? true : undefined}
          >
            <option value="ph">{t("logReadingForm.kindPh")}</option>
            <option value="temp">{t("logReadingForm.kindTemp")}</option>
            <option value="brix">{t("logReadingForm.kindBrix")}</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="reading-value">
            {t("logReadingForm.valueLabel")}
          </label>
          <input
            id="reading-value"
            name="value"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder={t("logReadingForm.valuePlaceholder")}
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
          {pending ? t("logReadingForm.logging") : t("logReadingForm.logReading")}
        </Button>
      </div>
    </form>
  );
}
