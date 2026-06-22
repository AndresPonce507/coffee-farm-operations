import { AlertTriangle, Beaker, Hourglass, Sparkles } from "lucide-react";

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
  const { targetPh, latestPh, hoursElapsed, cutReached } = cutpoint;

  // No recipe → nothing to cut against.
  if (targetPh === null) {
    return (
      <div
        data-testid="cutpoint-no-recipe"
        className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/50 px-4 py-3 text-sm text-muted-fg"
      >
        <Beaker className="h-4 w-4 shrink-0 text-muted-fg/70" aria-hidden />
        <span>No recipe applied — apply a recipe to project the cut-point.</span>
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
        <span>No readings yet — log a pH reading to start tracking the cut.</span>
      </div>
    );
  }

  const hours = hoursElapsed !== null ? `${hoursElapsed.toFixed(1)}h in` : "";

  if (cutReached) {
    return (
      <div
        role="alert"
        data-testid="cutpoint-cut-now"
        className={cn(
          "flex items-center gap-3 rounded-xl border border-cherry-100 bg-cherry-100/90 px-4 py-3",
          // text-[#7a121e] = dark cherry: 8.57:1 on bg-cherry-100/90 (WCAG-AA, AAA for
          // the main line) — keeps the red-alert semantic where text-cherry fails at 4.21:1.
          "text-sm font-semibold text-[#7a121e] shadow-[0_12px_32px_-12px_rgba(122,18,30,0.4)]",
          "motion-safe:animate-pulse",
        )}
      >
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        <div>
          <p>Cut now — pH {latestPh} has reached the {targetPh} target.</p>
          <p className="mt-0.5 text-xs font-normal text-[#7a121e]">
            {hours} · the ferment window is closing.
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
        <p className="font-medium">Tracking — pH {latestPh}, target {targetPh}.</p>
        <p className="mt-0.5 text-xs text-forest-700/80">
          {hours} · cut alert fires when pH reaches the target band.
        </p>
      </div>
    </div>
  );
}
