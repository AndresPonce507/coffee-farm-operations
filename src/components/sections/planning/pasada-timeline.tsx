import { CalendarDays, CloudRain, ListTodo, Mountain } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
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

const RIPE_STYLES: Record<RipenessTarget, { chip: string; labelKey: string }> = {
  high: { chip: "border-forest/40 bg-forest-100/60 text-forest", labelKey: "ripeHigh" },
  medium: { chip: "border-honey/40 bg-honey-100/60 text-honey-700", labelKey: "ripeMedium" },
  low: { chip: "border-sky/40 bg-sky-100/60 text-sky", labelKey: "ripeLow" },
};

export function PasadaTimeline({ plans }: { plans: PasadaPlan[] }) {
  const t = useTranslations("planning");
  if (plans.length === 0) {
    return (
      <Card data-testid="pasada-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={CalendarDays}
            title={t("pasadaTimeline.emptyTitle")}
            description={t("pasadaTimeline.emptyDescription")}
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
                      <EntityLink kind="plot" id={p.plotId} name={p.plotName}>
                        {p.plotName}
                      </EntityLink>
                    </h3>
                    <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-fg">
                      {t("pasadaTimeline.pasadaNumber", { number: p.pasadaNumber })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                    <span>{p.variety}</span>
                    <span className="inline-flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5" aria-hidden />
                      {t("pasadaTimeline.masl", { altitude: num(p.altitudeMasl) })}
                    </span>
                    {p.reason ? (
                      <span className="inline-flex items-center gap-1 text-cherry">
                        <CloudRain className="h-3.5 w-3.5" aria-hidden />
                        {t("pasadaTimeline.replanned", { reason: p.reason })}
                      </span>
                    ) : null}
                  </div>
                  {p.firedTaskId ? (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-cherry">
                      <ListTodo className="h-3.5 w-3.5" aria-hidden /> {t("pasadaTimeline.onTheBoard")}
                    </p>
                  ) : null}
                </div>

                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    ripe.chip,
                  )}
                >
                  {t(`pasadaTimeline.${ripe.labelKey}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
