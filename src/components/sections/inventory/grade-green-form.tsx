"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Coffee, Sparkles, X } from "lucide-react";

import type { ScaGrade } from "@/lib/types";
import {
  gradeGreenLotAction,
  INVENTORY_IDLE,
  type InventoryActionState,
} from "@/app/(app)/inventory/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * GradeGreenForm — the GRADE / materialize-green client island for /inventory.
 *
 * This is the missing UI for the ONLY green-lot writer (review finding #16): the
 * `gradeGreenLotAction` → `materialize_green_lot` RPC had no front door, so green
 * sellable inventory could only appear via seed. Here the family GRADES a finished
 * MILLED lot into a located, available-to-promise GREEN lot: pick a source, enter
 * green-kg + cupping score + warehouse location, submit → a new GREEN node
 * (`JC-NNN-G`) exists with its derived SCA grade and a live ATP on the table.
 *
 * Glass styling matches atp-table / reservation-drawer / the ui primitives — a
 * right-anchored glass drawer (GPU transform/opacity only). The oversell /
 * conservation guards live in the database (the S3 conservation trigger + the
 * `green_lots` CHECKs are fail-closed); this island surfaces a rejection as a
 * clean on-brand alert, never a raw Postgres exception. Inline validation mirrors
 * the command's friendly-error seam so most mistakes never reach the round-trip.
 *
 * The SCA grade preview is derived client-side from the cupping score, matching
 * the DB's GENERATED `sca_grade` band exactly (D-INV-3) so the family sees the
 * grade they're about to mint before they commit.
 */

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100 disabled:opacity-50";
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
  const [open, setOpen] = useState(false);
  const empty = sources.length === 0;

  return (
    <>
      <Button
        type="button"
        disabled={empty}
        onClick={() => setOpen(true)}
        aria-label={
          empty ? "Grade green lot — no milled lots to grade" : "Grade green lot"
        }
        title={empty ? "No milled lots ready to grade" : undefined}
      >
        <Sparkles className="h-4 w-4" />
        Grade green lot
      </Button>

      {open && (
        <GradePanel sources={sources} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function GradePanel({
  sources,
  onClose,
}: {
  sources: string[];
  onClose: () => void;
}) {
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

  // Escape-to-close + scroll lock while the drawer is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const fieldError = (key: string) =>
    state.status === "error" ? state.errors?.[key] : undefined;

  const errorMessage =
    state.status === "error" && state.message ? state.message : null;

  const succeeded = state.status === "success";
  const greenCode = succeeded ? state.greenLotCode : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Grade and materialize a green lot"
    >
      {/* Click-away scrim. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-forest/40 backdrop-blur-sm"
      />

      {/* The drawer panel — slides in from the right (GPU transform). */}
      <div className="animate-rise relative z-10 flex h-full w-full max-w-md flex-col border-l border-white/60 bg-white/85 p-6 shadow-[0_24px_64px_-20px_rgba(0,41,29,0.45)] backdrop-blur-xl">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Grade green lot
            </h2>
            <p className="mt-0.5 text-sm text-muted-fg">
              Promote a milled lot into located, sellable green coffee
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-fg transition hover:bg-white/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {succeeded && greenCode ? (
          <GradeSuccess
            greenCode={greenCode}
            grade={previewGrade}
            onClose={onClose}
          />
        ) : (
          <form
            action={formAction}
            className="mt-5 flex flex-1 flex-col gap-3 overflow-y-auto"
          >
            {/* ── Source (milled) lot ── */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="grade-source">
                Source lot
              </label>
              <select
                id="grade-source"
                name="sourceCode"
                defaultValue=""
                className={FIELD}
              >
                <option value="" disabled>
                  Choose a milled lot…
                </option>
                {sources.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              {fieldError("sourceCode") && (
                <p className="text-xs text-cherry">
                  {fieldError("sourceCode")}
                </p>
              )}
            </div>

            {/* The green code is derived server-side semantics but the family
                still names it — defaulting to the conventional <source>-G trace
                code keeps the genealogy readable. Mirrored from the picked source
                with a small helper so it stays in sync but remains overridable. */}
            <GreenCodeField error={fieldError("greenCode")} />

            {/* ── Green kilograms ── */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="grade-kg">
                Green kilograms
              </label>
              <input
                id="grade-kg"
                name="kg"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 240"
                className={FIELD}
              />
              {fieldError("kg") && (
                <p className="text-xs text-cherry">{fieldError("kg")}</p>
              )}
            </div>

            {/* ── Cupping score + live SCA grade preview ── */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="grade-cupping">
                Cupping score
              </label>
              <input
                id="grade-cupping"
                name="cuppingScore"
                type="number"
                min="0"
                max="100"
                step="0.25"
                placeholder="0–100"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className={FIELD}
              />
              {fieldError("cuppingScore") && (
                <p className="text-xs text-cherry">
                  {fieldError("cuppingScore")}
                </p>
              )}
              {/* Live grade preview — the band the DB will GENERATE from the
                  score, shown before the family commits. */}
              <div
                data-testid="grade-preview"
                aria-live="polite"
                className="flex items-center gap-2 pt-1 text-xs text-muted-fg"
              >
                {previewGrade ? (
                  <>
                    <span>Grades as</span>
                    <Badge tone={GRADE_TONE[previewGrade]} dot>
                      {previewGrade}
                    </Badge>
                  </>
                ) : (
                  <span className="text-muted-fg/70">
                    Enter a score to preview the SCA grade
                  </span>
                )}
              </div>
            </div>

            {/* ── Warehouse location ── */}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="grade-location">
                Warehouse location
              </label>
              <input
                id="grade-location"
                name="location"
                placeholder="e.g. Warehouse A · Bay 3"
                className={FIELD}
              />
              {fieldError("location") && (
                <p className="text-xs text-cherry">
                  {fieldError("location")}
                </p>
              )}
            </div>

            <div className="mt-auto flex justify-end gap-2 pt-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Grading…" : "Grade & materialize"}
              </Button>
            </div>
          </form>
        )}

        {/* Friendly error region — a clean on-brand alert for a CHECK / conservation
            rejection, never a raw Postgres exception. aria-live announces it. */}
        {errorMessage && (
          <div
            data-testid="grade-error-region"
            aria-live="assertive"
            className="pointer-events-none absolute inset-x-6 bottom-6"
          >
            <div
              role="alert"
              className={cn(
                "flex items-start gap-2 rounded-xl border border-cherry-100 bg-cherry-100/95 px-4 py-3",
                "text-sm font-medium text-cherry shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)] backdrop-blur-md",
              )}
            >
              <Coffee className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{friendlyError(errorMessage)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The green traceability code, defaulting to the conventional `<source>-G` form
 * as the family picks a source — kept overridable so an unusual code is still
 * possible. A tiny client field reading the sibling source <select>.
 */
function GreenCodeField({ error }: { error?: string }) {
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);

  // Mirror the source select into a suggested green code until the family edits.
  useEffect(() => {
    const select = document.getElementById(
      "grade-source",
    ) as HTMLSelectElement | null;
    if (!select) return;
    const onChange = () => {
      if (!touched && select.value) setCode(`${select.value}-G`);
    };
    select.addEventListener("change", onChange);
    return () => select.removeEventListener("change", onChange);
  }, [touched]);

  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor="grade-green-code">
        Green lot code
      </label>
      <input
        id="grade-green-code"
        name="greenCode"
        value={code}
        onChange={(e) => {
          setTouched(true);
          setCode(e.target.value);
        }}
        placeholder="e.g. JC-564-G"
        className={cn(FIELD, "font-mono")}
      />
      {error && <p className="text-xs text-cherry">{error}</p>}
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
  return (
    <div className="mt-6 flex flex-1 flex-col">
      <div className="rounded-2xl border border-forest-300 bg-forest-100/70 p-5 text-center shadow-[0_12px_32px_-16px_rgba(0,41,29,0.4)]">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-forest-100 text-forest">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-forest-600">
          Green lot materialized
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
        <p className="mt-3 text-xs text-muted-fg">
          It&rsquo;s now located, graded, and available to promise on the table.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Link
          href={`/lots/${greenCode}`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-forest px-4 text-sm font-medium text-paper shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_0_rgba(0,41,29,0.25)] transition-all duration-200 ease-out hover:bg-forest-700 hover:-translate-y-px"
        >
          View lot traceability
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * Strip the command's `materialize_green_lot: ` prefix (and a doubled SQL prefix)
 * so the family reads the constraint reason, not the function name.
 */
function friendlyError(message: string): string {
  return message.replace(/^materialize_green_lot:\s*/i, "").trim() || message;
}
