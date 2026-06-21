import { CalendarDays, CloudRain, Mountain } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, num } from "@/lib/utils";
import type { PasadaPlan, RipenessTarget } from "@/lib/types";

/**
 * PasadaTimeline — the staggered harvest-pass calendar.
 *
 * Pure Server Component: the active pasada schedule as a vertical timeline,
 * ordered by predicted pick date so it reads as a wave moving UP the mountain —
 * the lower, warmer plots first, the high Geisha last. Each pass shows its plot,
 * altitude (the visible stagger), ripeness target, and — when it was re-planned
 * around a rain front — the reason, so the audit trail of the plan is legible.
 *
 * World-class: glass-lite cards, a connecting rail, GPU-only hover lift,
 * reduced-motion safe, AA contrast.
 */

const RIPE_STYLES: Record<RipenessTarget, { chip: string; label: string }> = {
  high: { chip: "border-forest/40 bg-forest-100/60 text-forest", label: "peak ripe" },
  medium: { chip: "border-honey/40 bg-honey-100/60 text-honey-700", label: "ripe" },
  low: { chip: "border-sky/40 bg-sky-100/60 text-sky", label: "early pass" },
};

export function PasadaTimeline({ plans }: { plans: PasadaPlan[] }) {
  if (plans.length === 0) {
    return (
      <Card data-testid="pasada-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={CalendarDays}
            title="No passes scheduled yet"
            description="Schedule a pasada from a ready plot and it lands here — staggered down the altitude gradient — and fires a task onto the board."
          />
        </CardContent>
      </Card>
    );
  }

  // already ordered by the getter; defensively re-sort by date for the timeline.
  const ordered = [...plans].sort((a, b) =>
    a.predictedReadyDate.localeCompare(b.predictedReadyDate),
  );

  return (
    <Card className="animate-rise overflow-hidden">
      <CardContent className="p-0">
        <ol className="stagger relative divide-y divide-white/50">
          {ordered.map((p) => {
            const ripe = RIPE_STYLES[p.ripenessTarget];
            return (
              <li
                key={p.id}
                data-testid={`pasada-${p.id}`}
                className="glass-hover relative flex items-center gap-4 p-4 transition-transform"
              >
                {/* date marker */}
                <div className="flex w-20 shrink-0 flex-col items-center text-center">
                  <CalendarDays className="h-4 w-4 text-forest" aria-hidden />
                  <span className="mt-1 text-xs font-semibold tabular-nums text-ink">
                    {p.predictedReadyDate.slice(5)}
                  </span>
                  <span className="text-[10px] text-muted-fg">
                    {p.predictedReadyDate.slice(0, 4)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-display text-sm font-semibold text-ink">
                      {p.plotName}
                    </h3>
                    <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-fg">
                      Pasada {p.pasadaNumber}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                    <span>{p.variety}</span>
                    <span className="inline-flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5" aria-hidden />
                      {num(p.altitudeMasl)} masl
                    </span>
                    {p.reason ? (
                      <span className="inline-flex items-center gap-1 text-cherry">
                        <CloudRain className="h-3.5 w-3.5" aria-hidden />
                        re-planned · {p.reason}
                      </span>
                    ) : null}
                  </div>
                </div>

                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    ripe.chip,
                  )}
                >
                  {ripe.label}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
