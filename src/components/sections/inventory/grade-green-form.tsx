"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Coffee, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ScaGrade } from "@/lib/types";
import {
  gradeGreenLotAction,
  INVENTORY_IDLE,
  type InventoryActionState,
} from "@/app/(app)/inventory/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EntityLink } from "@/components/ui/entity-link";
import { cn } from "@/lib/utils";

/**
 * GradeGreenForm — the GRADE / materialize-green client island for /inventory.
 *
 * This is the missing UI for the ONLY green-lot writer (review finding #16): the
 * `gradeGreenLotAction` → `materialize_green_lot` RPC had no front door, so green
 * sellable inventory could only appear via seed. Here the family GRADES a finished
 * MILLED lot into a located, available-to-promise GREEN lot: pick a source, enter
 * green-kg + cupping score + warehouse location, submit → a new GREEN node exists
 * with its derived SCA grade and a live ATP on the table.
 *
 * The green code is SYSTEM IDENTITY, minted server-side by `materialize_green_lot`
 * (migration 20260621120000) — there is NO user-facing green-code field. The old
 * `<source>-G` suggestion violated `lots_code_format` (`^JC-[0-9]{3,}$`) and broke
 * every grade; now the form passes none and the SUCCESS state shows the RETURNED
 * minted JC-NNN with its /lots/[code] trace link.
 *
 * The drawer is the shared <Dialog> primitive (focus-trap / initial-focus /
 * restore + Escape + scroll-lock, all tested) — not a rolled-own modal. The
 * oversell / conservation guards live in the database (the S3 conservation trigger
 * + the `green_lots` CHECKs are fail-closed); this island surfaces a rejection as
 * a clean on-brand alert in normal flow, never a raw Postgres exception. Inline
 * validation mirrors the command's friendly-error seam so most mistakes never
 * reach the round-trip.
 *
 * The SCA grade preview is derived client-side from the cupping score, matching
 * the DB's GENERATED `sca_grade` band exactly (D-INV-3) so the family sees the
 * grade they're about to mint before they commit.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50 aria-[invalid=true]:border-cherry aria-[invalid=true]:ring-cherry-100";
const LABEL = "text-xs font-medium text-muted-fg";

const GRADE_TONE: Record<ScaGrade, BadgeTone> = {
  Presidential: "forest",
  Specialty: "honey",
  Premium: "coffee",
  "Below Specialty": "neutral",
};

/**
 * Band a cupping score into an SCA grade — the EXACT thresholds the
 * `green_lots.sca_grade` GENERATED column uses (≥90 Presidential, ≥85 Specialty,
 * ≥80 Premium, else Below Specialty). Returns null for an empty / out-of-range
 * score so the preview stays quiet until a real grade is entered.
 */
export function bandScaGrade(score: number | null): ScaGrade | null {
  if (score === null || Number.isNaN(score) || score < 0 || score > 100) {
    return null;
  }
  if (score >= 90) return "Presidential";
  if (score >= 85) return "Specialty";
  if (score >= 80) return "Premium";
  return "Below Specialty";
}

export function GradeGreenForm({ sources }: { sources: string[] }) {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const empty = sources.length === 0;

  return (
    <>
      <Button
        type="button"
        disabled={empty}
        onClick={() => setOpen(true)}
        aria-label={
          empty
            ? t("gradeForm.triggerDisabledLabel")
            : t("gradeForm.triggerLabel")
        }
        title={empty ? t("gradeForm.triggerDisabledTitle") : undefined}
      >
        <Sparkles className="h-4 w-4" />
        {t("gradeForm.trigger")}
      </Button>

      {/* Dialog renders its children only while open and unmounts them on close,
          so GradeBody (and its stable idempotency token + cupping-preview state)
          is fresh each time the drawer is opened. */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("gradeForm.dialogTitle")}
      >
        <GradeBody sources={sources} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function GradeBody({
  sources,
  onClose,
}: {
  sources: string[];
  onClose: () => void;
}) {
  const t = useTranslations("inventory");
  const [state, formAction, pending] = useActionState<
    InventoryActionState,
    FormData
  >(gradeGreenLotAction, INVENTORY_IDLE);

  // The cupping score is mirrored into local state purely to drive the live SCA
  // grade preview; the form still submits the field by name (no controlled hijack
  // of the actual submission path).
  const [score, setScore] = useState("");
  const previewGrade = useMemo(
    () => bandScaGrade(score.trim() === "" ? null : Number(score)),
    [score],
  );

  // A STABLE idempotency token for the life of this dialog-open. Because the green
  // code is now server-minted, a re-submit mints a NEW code (materialize is
  // exactly-once only on a SUPPLIED code); this stable token + the
  // disabled-during-pending guard below mitigate a double mint from a fast
  // double-click. `useId` is stable across re-renders, so typing never churns it.
  const idempotencyKey = useId();

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;
  const invalid = (key: string) => (fieldError(key) ? true : undefined);

  const errorMessage =
    state.status === "error" && state.message ? state.message : null;

  const succeeded = state.status === "success";
  const greenCode = succeeded ? state.greenLotCode : undefined;

  if (succeeded && greenCode) {
    return (
      <GradeSuccess greenCode={greenCode} grade={previewGrade} onClose={onClose} />
    );
  }

  return (
    <div className="flex flex-col">
      <p className="-mt-2 mb-3 text-sm text-muted-fg">{t("gradeForm.lead")}</p>

      <form action={formAction} className="flex flex-col gap-3">
        {/* The green code is system identity — minted server-side and shown back
            on success. The form carries a STABLE idempotency token so a fast
            double-submit reuses the same key. */}
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        {/* ── Source (milled) lot ── */}
        <div className="space-y-1">
          <label className={LABEL} htmlFor="grade-source">
            {t("gradeForm.sourceLabel")}
          </label>
          <select
            id="grade-source"
            name="sourceCode"
            defaultValue=""
            className={FIELD}
            aria-invalid={invalid("sourceCode")}
          >
            <option value="" disabled>
              {t("gradeForm.sourcePlaceholder")}
            </option>
            {sources.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {fieldError("sourceCode") && (
            <p className="text-xs text-cherry">{fieldError("sourceCode")}</p>
          )}
        </div>

        {/* ── Green kilograms ── */}
        <div className="space-y-1">
          <label className={LABEL} htmlFor="grade-kg">
            {t("gradeForm.kgLabel")}
          </label>
          <input
            id="grade-kg"
            name="kg"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder={t("gradeForm.kgPlaceholder")}
            className={FIELD}
            aria-invalid={invalid("kg")}
          />
          {fieldError("kg") && (
            <p className="text-xs text-cherry">{fieldError("kg")}</p>
          )}
        </div>

        {/* ── Cupping score + live SCA grade preview ── */}
        <div className="space-y-1">
          <label className={LABEL} htmlFor="grade-cupping">
            {t("gradeForm.cuppingLabel")}
          </label>
          <input
            id="grade-cupping"
            name="cuppingScore"
            type="number"
            min="0"
            max="100"
            step="0.25"
            placeholder={t("gradeForm.cuppingPlaceholder")}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className={FIELD}
            aria-invalid={invalid("cuppingScore")}
          />
          {fieldError("cuppingScore") && (
            <p className="text-xs text-cherry">{fieldError("cuppingScore")}</p>
          )}
          {/* Live grade preview — the band the DB will GENERATE from the score,
              shown before the family commits. */}
          <div
            data-testid="grade-preview"
            aria-live="polite"
            className="flex items-center gap-2 pt-1 text-xs text-muted-fg"
          >
            {previewGrade ? (
              <>
                <span>{t("gradeForm.gradesAs")}</span>
                <Badge tone={GRADE_TONE[previewGrade]} dot>
                  {previewGrade}
                </Badge>
              </>
            ) : (
              <span className="text-muted-fg/70">
                {t("gradeForm.previewHint")}
              </span>
            )}
          </div>
        </div>

        {/* ── Warehouse location ── */}
        <div className="space-y-1">
          <label className={LABEL} htmlFor="grade-location">
            {t("gradeForm.locationLabel")}
          </label>
          <input
            id="grade-location"
            name="location"
            placeholder={t("gradeForm.locationPlaceholder")}
            className={FIELD}
            aria-invalid={invalid("location")}
          />
          {fieldError("location") && (
            <p className="text-xs text-cherry">{fieldError("location")}</p>
          )}
        </div>

        {/* Friendly error — a clean on-brand alert for a CHECK / conservation
            rejection, in NORMAL FLOW above the buttons (never absolutely
            positioned over them). A SINGLE live region (role=alert is implicitly
            assertive) — no double announce. */}
        {errorMessage && (
          <div
            data-testid="grade-error-region"
            role="alert"
            className={cn(
              "flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
              "text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)]",
            )}
          >
            <Coffee className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("gradeForm.cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("gradeForm.grading") : t("gradeForm.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The success panel — the minted green lot, its banded grade, and a trace link. */
function GradeSuccess({
  greenCode,
  grade,
  onClose,
}: {
  greenCode: string;
  grade: ScaGrade | null;
  onClose: () => void;
}) {
  const t = useTranslations("inventory");
  return (
    <div role="status" className="flex flex-col">
      <div className="rounded-2xl border border-forest-300 bg-forest-100/70 p-5 text-center shadow-[0_12px_32px_-16px_rgba(0,41,29,0.4)]">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-forest-100 text-forest">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-forest-600">
          {t("gradeForm.successEyebrow")}
        </p>
        <p className="mt-1 font-mono text-xl font-semibold text-ink">
          {greenCode}
        </p>
        {grade && (
          <div className="mt-2 flex justify-center">
            <Badge tone={GRADE_TONE[grade]} dot>
              {grade}
            </Badge>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-fg">{t("gradeForm.successBody")}</p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <EntityLink
          kind="lot"
          id={greenCode}
          name={greenCode}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-forest px-4 text-sm font-medium text-paper shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_0_rgba(0,41,29,0.25)] transition-all duration-200 ease-out hover:bg-forest-700 hover:-translate-y-px"
        >
          {t("gradeForm.viewTraceability")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </EntityLink>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("gradeForm.done")}
        </Button>
      </div>
    </div>
  );
}
