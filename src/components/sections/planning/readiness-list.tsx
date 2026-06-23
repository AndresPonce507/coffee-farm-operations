import { CalendarClock, Leaf, Mountain, Sprout } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import { cn, longDate, num } from "@/lib/utils";
import type { PlotReadiness } from "@/lib/types";

import {
  confidenceLabel,
  readinessLabel,
  readinessTone,
  TONE_STYLES,
} from "./readiness";

/**
 * ReadinessList — the readiness-ranked plot list, the planner's heart.
 *
 * Pure Server Component (no client JS): every plot's DERIVED readiness as an
 * accessible meter, tinted by tone (forest = ready, honey = approaching, sky =
 * early), with its altitude (the gradient stagger), predicted pick date, and an
 * HONEST confidence note that is surfaced, never hidden. Rows arrive pre-ranked
 * most-ready-first from getHarvestReadiness.
 *
 * World-class: glass-lite cards (no blur on content), a GPU-only width transition
 * on the meter fill, `motion-reduce` disables it, AA contrast on the paper canvas,
 * keyboard/AT-legible via role="progressbar" + aria-valuenow.
 */
export function ReadinessList({ rows }: { rows: PlotReadiness[] }) {
  if (rows.length === 0) {
    return (
      <Card data-testid="readiness-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={Sprout}
            title="No plots to plan yet"
            description="Log a bloom and the GDD feed for a plot and its readiness appears here, ranked and staggered down the altitude gradient."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="stagger space-y-3">
      {rows.map((r) => {
        const tone = readinessTone(r.readiness);
        const styles = TONE_STYLES[tone];
        const pct = Math.round(Math.min(1, Math.max(0, r.readiness)) * 100);
        return (
          <EntityLink
            key={r.plotId}
            kind="plot"
            id={r.plotId}
            name={r.plotName}
            className="group block rounded-2xl"
          >
          <Card
            data-testid={`readiness-${r.plotId}`}
            className="glass-hover animate-rise overflow-hidden transition group-hover:ring-1 group-hover:ring-forest/30"
          >
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", styles.dot)}
                    />
                    <h3 className="truncate font-display text-base font-semibold text-ink">
                      {r.plotName}
                    </h3>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                    <span className="inline-flex items-center gap-1">
                      <Leaf className="h-3.5 w-3.5" aria-hidden /> {r.variety}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5" aria-hidden />
                      {num(r.altitudeMasl)} masl
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("font-display text-lg font-bold tabular-nums", styles.text)}>
                    {pct}%
                  </p>
                  <p className={cn("text-[11px] font-medium", styles.text)}>
                    {readinessLabel(r.readiness)}
                  </p>
                </div>
              </div>

              {/* Derived-readiness meter — GPU-only width, reduced-motion safe. */}
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${r.plotName} readiness`}
                className="h-2 w-full overflow-hidden rounded-full bg-ink/5"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
                    styles.bar,
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-fg">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {r.predictedReadyDate ? (
                    <>Ready ~ {longDate(r.predictedReadyDate)}</>
                  ) : (
                    <span className="italic">No bloom logged — date unknown</span>
                  )}
                </span>
                <span
                  className={cn(
                    "rounded-full border border-white/60 bg-white/55 px-2 py-0.5 text-[11px] font-medium",
                    r.confidence === "low" ? "text-muted-fg" : styles.text,
                  )}
                >
                  {confidenceLabel(r.confidence)}
                </span>
              </div>
            </CardContent>
          </Card>
          </EntityLink>
        );
      })}
    </div>
  );
}
