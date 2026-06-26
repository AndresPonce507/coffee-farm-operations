"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Droplets } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DRYING_IDLE,
  recordMoistureAction,
  type DryingActionState,
} from "@/app/(app)/drying/actions";
import { Button } from "@/components/ui/button";

/**
 * RecordMoistureForm — appends a moisture reading to a lot's drying curve through
 * the single write door (`recordMoistureAction` → the `record_moisture_reading`
 * SECURITY DEFINER RPC). The reading is the EVIDENCE the reposo gate reads: a lot
 * cannot advance drying→milled until its readings sit stable in the 10.5–11.5%
 * band. Until this form existed there was no way to feed the gate from the app.
 *
 * Liquid-glass, reduced-motion-safe, WCAG-AA: matches the cherry-intake-form field
 * vocabulary. Inline per-field validation + friendly errors (the SQL CHECK is the
 * real guard; these surface before the round-trip). Carries a STABLE hidden
 * idempotency key per dialog-open so a double-submit is a DB no-op.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

export function RecordMoistureForm({
  lots,
  defaultLot,
  onDone,
}: {
  /** Lot codes currently resting (the gate's candidates). */
  lots: string[];
  /** Pre-selected lot when opened from a specific lot card. */
  defaultLot?: string;
  /** Called after a successful record so the host (dialog) can offer to close. */
  onDone?: () => void;
}) {
  const t = useTranslations("drying");
  const [state, formAction, pending] = useActionState<
    DryingActionState,
    FormData
  >(recordMoistureAction, DRYING_IDLE);

  // STABLE exactly-once anchor minted ONCE per dialog-open. The form carries it as
  // a hidden field so a double-submit re-uses the SAME key: the RPC short-circuits
  // on `idempotency_key` and returns the existing reading instead of a second row.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-4 py-4 text-center"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-forest-50 text-forest ring-1 ring-forest-100">
          <CheckCircle2 className="h-7 w-7" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-display text-base font-semibold text-ink">
            {t("recordForm.successTitle")}
          </p>
          <p className="text-sm text-muted-fg">{state.message}</p>
        </div>
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {t("recordForm.done")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <p className="flex items-start gap-2 rounded-xl bg-forest-50/70 px-3 py-2 text-xs text-forest-700 ring-1 ring-forest-100">
        <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("recordForm.hint")}</span>
      </p>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="moisture-lotCode">
          {t("recordForm.lotLabel")}
        </label>
        <select
          id="moisture-lotCode"
          name="lotCode"
          defaultValue={defaultLot ?? ""}
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("lotCode") ? true : undefined}
        >
          <option value="" disabled>
            {t("recordForm.choose")}
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
        <label className={LABEL} htmlFor="moisture-pct">
          {t("recordForm.moistureLabel")}
        </label>
        <input
          id="moisture-pct"
          name="moisturePct"
          type="number"
          min="0"
          max="100"
          step="0.1"
          inputMode="decimal"
          placeholder={t("recordForm.moisturePlaceholder")}
          required
          disabled={pending}
          className={FIELD}
          aria-invalid={fieldError("moisturePct") ? true : undefined}
        />
        {fieldError("moisturePct") && (
          <p className="text-xs text-cherry">{fieldError("moisturePct")}</p>
        )}
      </div>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-xs font-medium text-cherry">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("recordForm.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("recordForm.submitting") : t("recordForm.submit")}
        </Button>
      </div>
    </form>
  );
}
