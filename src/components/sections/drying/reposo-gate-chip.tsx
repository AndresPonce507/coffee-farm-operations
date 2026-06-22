import { CheckCircle2, Lock, Hourglass, Droplets } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReposoStatus } from "@/lib/types";

/**
 * ReposoGateChip — the at-a-glance verdict of THE REPOSO GATE for one lot.
 *
 * Red ("resting · 4/10 days · 11.8%") with a lock when the gate is closed; green
 * ("rest-stable · clear to mill") with a check when it's open. The chip surfaces
 * the EXACT reason the database will give — but the chip is courtesy; the real
 * enforcement is the precondition inside advance_processing_stage + the
 * BEFORE-UPDATE trigger backstop on `lots`. A blocked advance is impossible at the
 * data layer regardless of what this chip says.
 *
 * Accessibility: the readout rides an opaque token background (never sampling the
 * translucent aurora behind it), so the contrast floor holds. Static markup — no
 * animation — and the icon is decorative (the text carries the meaning).
 */
export function ReposoGateChip({
  reposo,
  className,
}: {
  reposo: ReposoStatus;
  className?: string;
}) {
  const ready = reposo.ready;
  // One-decimal moisture readout (pct() rounds to integer, so format directly).
  const moisture =
    reposo.latestMoisture == null ? "—" : `${reposo.latestMoisture.toFixed(1)}%`;
  const restDays =
    reposo.restDaysElapsed == null ? null : Math.floor(reposo.restDaysElapsed);

  const Icon = ready ? CheckCircle2 : reposo.moistureStable ? Hourglass : Droplets;

  return (
    <span
      role="status"
      data-ready={ready ? "true" : "false"}
      aria-label={
        ready
          ? `Reposo gate open: ${reposo.reason}`
          : `Reposo gate closed: ${reposo.reason}`
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
        "shadow-[0_1px_2px_rgba(27,23,18,0.14)]",
        ready
          ? "bg-forest-100 text-forest-600"
          // Blocked is the most-shown state, read outdoors in glare. Plain
          // `text-cherry` (#b5482e) on the cherry-100 tint is only 4.124:1 — under
          // the WCAG-AA 4.5:1 floor for this 12px-semibold label. Darken the TEXT to
          // #8f3522 (6.0:1 on the tint, 7.78:1 on white) while keeping the red tint.
          // Mirrors the honey-700/forest-600 "darker text on light bg" pattern; an
          // inline hex (not a token) because the shared globals.css/badge tokens are
          // out of this slice's edit scope.
          : "bg-cherry-100 text-[#8f3522]",
        className,
      )}
    >
      {ready ? (
        <Icon aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Lock aria-hidden className="h-3.5 w-3.5" />
      )}
      <span className="tabular-nums">
        {ready ? "Rest-stable" : "Resting"}
        {!ready && restDays != null && (
          <>
            {" · "}
            {restDays} day{restDays === 1 ? "" : "s"}
          </>
        )}
        {reposo.latestMoisture != null && (
          <>
            {" · "}
            {moisture}
          </>
        )}
      </span>
      <span className="font-medium opacity-80">
        {ready ? "clear to mill" : "blocked"}
      </span>
    </span>
  );
}
