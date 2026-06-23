"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CheckCircle2, Sprout } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CoffeeVariety, Plot, Worker } from "@/lib/types";
import {
  INTAKE_IDLE,
  recordCherryIntakeAction,
  type IntakeActionState,
} from "@/app/(app)/harvests/actions";
import { Button } from "@/components/ui/button";
import { EntityLink } from "@/components/ui/entity-link";

/**
 * CherryIntakeForm — the genesis WRITE of the whole farm-to-bag spine.
 *
 * Unlike the simple "Log harvest" form (which appends a `harvests` row), this
 * records a picker's lata of cherry through the *single write door* —
 * `recordCherryIntakeAction` → the `record_cherry_intake` SECURITY DEFINER RPC,
 * the gap-free monotonic JC-NNN minter. The success of this form is a brand-new
 * traceable lot: the canonical record that threads grow → harvest → process →
 * sell → comply, and the number COGS / EUDR / inventory all read.
 *
 * Liquid-glass, reduced-motion-safe, WCAG-AA: matches harvest-form.tsx's field
 * vocabulary and the ui primitives. Inline per-field validation + friendly
 * errors (the SQL CHECK is the real guard; these surface before the round-trip).
 * On success it celebrates the minted lot code and links straight to its
 * traceability page.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";
const LABEL = "text-xs font-medium text-muted-fg";

/** Mirrors the `coffee_variety` enum — the varieties grown on the finca. */
const VARIETIES: readonly CoffeeVariety[] = [
  "Geisha",
  "Caturra",
  "Catuaí",
  "Pacamara",
  "Typica",
];

export function CherryIntakeForm({
  plots,
  pickers,
  onDone,
}: {
  plots: Plot[];
  pickers: Worker[];
  /** Called after a successful mint so the host (dialog) can offer to close. */
  onDone?: () => void;
}) {
  const t = useTranslations("harvests");
  const [state, formAction, pending] = useActionState<
    IntakeActionState,
    FormData
  >(recordCherryIntakeAction, INTAKE_IDLE);

  // STABLE exactly-once anchor minted ONCE per dialog-open (the form unmounts on
  // close, so a lazy-initialised state value is fresh per open but stable across
  // every re-render — including an error round-trip). The form carries it as a
  // hidden field so a double-submit re-uses the SAME key: the
  // `record_cherry_intake` RPC short-circuits on `idempotency_key` and returns
  // the originally-minted lot instead of minting a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  // ── Success: the lot is minted. Celebrate it and route to its lineage. ──
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
            {t("cherryIntakeForm.minted")}
          </p>
          <p className="text-sm text-muted-fg">
            {t("cherryIntakeForm.mintedBefore")}{" "}
            <span className="font-medium text-ink">{state.lotCode}</span>{" "}
            {t("cherryIntakeForm.mintedAfter")}
          </p>
        </div>

        <EntityLink
          kind="lot"
          id={state.lotCode}
          name={state.lotCode}
          className="group inline-flex items-center gap-2 border border-white/60 bg-white/60 px-4 py-2 text-sm font-medium text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] transition hover:-translate-y-px hover:bg-white/75 hover:shadow-[0_8px_20px_-8px_rgba(0,41,29,0.18)]"
        >
          {t("cherryIntakeForm.viewLot", { code: state.lotCode })}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </EntityLink>

        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {t("cherryIntakeForm.done")}
          </Button>
        )}
      </div>
    );
  }

  // ── Capture: plot · picker · cherries · variety → mint. ──
  return (
    <form action={formAction} className="space-y-4">
      {/* Stable exactly-once anchor — see `idempotencyKey` above. A double-submit
          carries the same key, so the RPC dedupes to the originally-minted lot. */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <p className="flex items-start gap-2 rounded-xl bg-forest-50/70 px-3 py-2 text-xs text-forest-700 ring-1 ring-forest-100">
        <Sprout className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {t("cherryIntakeForm.intakeNoteBefore")}{" "}
          <span className="font-semibold">JC</span>{" "}
          {t("cherryIntakeForm.intakeNoteAfter")}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="intake-plotId">
            {t("cherryIntakeForm.plot")}
          </label>
          <select
            id="intake-plotId"
            name="plotId"
            defaultValue=""
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("plotId") ? true : undefined}
          >
            <option value="" disabled>
              {t("cherryIntakeForm.choose")}
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
          <label className={LABEL} htmlFor="intake-workerId">
            {t("cherryIntakeForm.picker")}
          </label>
          <select
            id="intake-workerId"
            name="workerId"
            defaultValue=""
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("workerId") ? true : undefined}
          >
            <option value="" disabled>
              {t("cherryIntakeForm.choose")}
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="intake-cherriesKg">
            {t("cherryIntakeForm.cherries")}
          </label>
          <input
            id="intake-cherriesKg"
            name="cherriesKg"
            type="number"
            min="0"
            step="0.1"
            inputMode="decimal"
            placeholder={t("cherryIntakeForm.cherriesPlaceholder")}
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("cherriesKg") ? true : undefined}
          />
          {fieldError("cherriesKg") && (
            <p className="text-xs text-cherry">{fieldError("cherriesKg")}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={LABEL} htmlFor="intake-variety">
            {t("cherryIntakeForm.variety")}
          </label>
          <select
            id="intake-variety"
            name="variety"
            defaultValue=""
            required
            disabled={pending}
            className={FIELD}
            aria-invalid={fieldError("variety") ? true : undefined}
          >
            <option value="" disabled>
              {t("cherryIntakeForm.choose")}
            </option>
            {VARIETIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {fieldError("variety") && (
            <p className="text-xs text-cherry">{fieldError("variety")}</p>
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
            {t("cherryIntakeForm.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("cherryIntakeForm.mintingLot") : t("cherryIntakeForm.recordIntake")}
        </Button>
      </div>
    </form>
  );
}
