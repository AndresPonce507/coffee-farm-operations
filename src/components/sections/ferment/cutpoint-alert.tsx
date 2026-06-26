import { AlertTriangle, Beaker, Hourglass, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FermentCutpoint } from "@/lib/db/ferment";
import { cn } from "@/lib/utils";

/**
 * CutpointAlert — the closed-loop cut-point signal for one batch (P2-S3). Pure
 * presentation over the `v_ferment_cutpoint` projection:
 *   - no recipe bound  → a quiet "apply a recipe" prompt (no target to cut against).
 *   - no readings yet   → a "waiting for readings" placeholder.
 *   - pH above target   → a calm tracking chip with the latest pH vs the target.
 *   - cut reached       → a PROMINENT, role=alert "CUT NOW" banner — the family hits
 *                         the cup-defining cut-point instead of guessing.
 *
 * GPU-only / reduced-motion friendly: the only motion is an opacity pulse gated by
 * `motion-safe:` so it is still on a reduced-motion device, just static.
 */
export function CutpointAlert({ cutpoint }: { cutpoint: FermentCutpoint }) {
  const t = useTranslations("ferment");
  const { targetPh, latestPh, hoursElapsed, cutReached } = cutpoint;

  // No recipe → nothing to cut against.
  if (targetPh === null) {
    return (
      <div
        data-testid="cutpoint-no-recipe"
        className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/50 px-4 py-3 text-sm text-muted-fg"
      >
        <Beaker className="h-4 w-4 shrink-0 text-muted-fg/70" aria-hidden />
        <span>{t("cutpoint.noRecipe")}</span>
      </div>
    );
  }

  // No readings yet → waiting.
  if (latestPh === null) {
    return (
      <div
        data-testid="cutpoint-waiting"
        className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/50 px-4 py-3 text-sm text-muted-fg"
      >
        <Hourglass className="h-4 w-4 shrink-0 text-muted-fg/70" aria-hidden />
        <span>{t("cutpoint.noReadings")}</span>
      </div>
    );
  }

  const hours =
    hoursElapsed !== null
      ? t("cutpoint.hoursElapsed", { hours: hoursElapsed.toFixed(1) })
      : "";

  if (cutReached) {
    return (
      <div
        role="alert"
        data-testid="cutpoint-cut-now"
        className={cn(
          "flex items-center gap-3 rounded-xl border border-cherry-100 bg-cherry-100/90 px-4 py-3",
          // cherry-700 (#8f3522) = dark cherry, strong AA on bg-cherry-100/90 — keeps the
          // red-alert emphasis via the shared token instead of a one-off hex (mirrors honey-700).
          "text-sm font-semibold text-cherry-700 shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)]",
          "motion-safe:animate-pulse",
        )}
      >
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        <div>
          <p>{t("cutpoint.cutNowTitle", { latest: latestPh, target: targetPh })}</p>
          <p className="mt-0.5 text-xs font-normal text-cherry-700">
            {t("cutpoint.cutNowSub", { hours })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="cutpoint-tracking"
      className="flex items-center gap-3 rounded-xl border border-forest-300/60 bg-forest-100/70 px-4 py-3 text-sm text-forest-700"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-forest" aria-hidden />
      <div>
        <p className="font-medium">
          {t("cutpoint.trackingTitle", { latest: latestPh, target: targetPh })}
        </p>
        <p className="mt-0.5 text-xs text-forest-700/80">
          {t("cutpoint.trackingSub", { hours })}
        </p>
      </div>
    </div>
  );
}
