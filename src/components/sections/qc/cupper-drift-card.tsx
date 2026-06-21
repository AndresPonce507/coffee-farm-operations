import { Gauge, Scale } from "lucide-react";

import type { CupperDrift } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { num } from "@/lib/utils";

/**
 * CupperDriftCard — the calibration-bias evidence card (P2-S6). On SHARED
 * calibration samples, each cupper's mean score per attribute is compared to the
 * panel mean; a systematic bias (e.g. +2 on acidity) is surfaced as EVIDENCE so a
 * scarce-lot decision is never silently turned on a biased score. It is never a
 * hard block — you correct for known drift, you don't reject a cupper's score.
 *
 * Server Component (no hooks). The drift sign is rendered with an explicit +/−
 * glyph and a tone (warm for over-scoring, cool for under-scoring) so the bias
 * direction reads at a glance. AA-on-glass; reduced-motion safe.
 */

/** A signed, glyph-prefixed drift string (e.g. "+2", "−1", "0"). */
function signedDrift(drift: number): string {
  const rounded = Number(num(Math.abs(drift), 1));
  if (Math.abs(drift) < 0.05) return "0";
  return `${drift > 0 ? "+" : "−"}${rounded}`;
}

function driftTone(drift: number): string {
  if (Math.abs(drift) < 0.05) return "text-muted-fg";
  if (Math.abs(drift) >= 1.5) return drift > 0 ? "text-cherry" : "text-sky-700";
  return drift > 0 ? "text-honey-700" : "text-forest-700";
}

export function CupperDriftCard({ drift }: { drift: CupperDrift[] }) {
  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Cupper-drift calibration</CardTitle>
          <CardDescription>
            Each cupper&apos;s bias vs the panel mean on shared calibration samples —
            evidence to correct for, never a score rejected
          </CardDescription>
        </div>
        <Gauge className="h-5 w-5 text-forest-600" aria-hidden />
      </CardHeader>

      <CardContent className="pt-4">
        {drift.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No calibration sessions yet"
            description="Cup a shared calibration sample with two or more cuppers to surface systematic bias here."
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {drift.map((d) => (
              <li
                key={`${d.cupperId}:${d.attribute}`}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-ink">
                    {d.cupperId}
                  </p>
                  <p className="mt-0.5 text-xs capitalize text-muted-fg">
                    {d.attribute} · panel {num(d.panelMean, 1)} · n={d.sampleN}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-display text-lg font-semibold tabular-nums ${driftTone(
                    d.drift,
                  )}`}
                  aria-label={`drift ${signedDrift(d.drift)} on ${d.attribute}`}
                >
                  {signedDrift(d.drift)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
