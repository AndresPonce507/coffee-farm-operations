import { CalendarRange, Mountain, Sprout } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getHarvestReadiness, getPasadaCalendar } from "@/lib/db/planning";
import { num } from "@/lib/utils";

import { PasadaTimeline } from "./pasada-timeline";
import { PlanActions } from "./plan-actions.client";
import { ReadinessList } from "./readiness-list";
import { readinessTone } from "./readiness";

/**
 * HarvestPlanner — the /plan planner, the cockpit that turns the maturation model
 * into the picker's morning.
 *
 * Async Server Component (no client JS): pulls every plot's DERIVED readiness
 * (getHarvestReadiness, ranked most-ready-first) and the active pasada calendar
 * (getPasadaCalendar, staggered down the altitude gradient), then lays out a
 * headline strip + two columns — the readiness-ranked plot list on the left, the
 * staggered pasada timeline on the right. Nothing here re-derives readiness; the
 * view is the SSOT.
 *
 * World-class: glass tiles + cards, a responsive 2-column split that stacks on
 * mobile, AA contrast on the paper canvas, reduced-motion safe (the only motion is
 * the stagger-in + the meter fill, both `motion-reduce` aware).
 */
export async function HarvestPlanner() {
  const t = await getTranslations("planning");
  const [readiness, calendar] = await Promise.all([
    getHarvestReadiness(),
    getPasadaCalendar(),
  ]);

  const readyCount = readiness.filter((r) => readinessTone(r.readiness) === "ready").length;
  const altitudes = readiness.map((r) => r.altitudeMasl).filter((a) => a > 0);
  const span =
    altitudes.length > 0
      ? `${num(Math.min(...altitudes))}–${num(Math.max(...altitudes))}`
      : "—";

  return (
    <div className="space-y-6">
      {/* Headline strip */}
      <Card className="animate-rise overflow-hidden">
        <CardContent className="p-0">
          <div className="stagger grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div data-testid="plan-ready-count">
              <Tile
                label={t("harvestPlanner.readyToPick")}
                value={num(readyCount)}
                sub={t("harvestPlanner.ofPlots", { count: num(readiness.length) })}
                accent="forest"
                icon={Sprout}
                className="glass-hover"
              />
            </div>
            <Tile
              label={t("harvestPlanner.passesScheduled")}
              value={num(calendar.length)}
              sub={t("harvestPlanner.passesScheduledSub")}
              accent="honey"
              icon={CalendarRange}
              className="glass-hover"
            />
            <Tile
              label={t("harvestPlanner.altitudeSpan")}
              value={span}
              sub={t("harvestPlanner.altitudeSpanSub")}
              accent="coffee"
              icon={Mountain}
              className="glass-hover"
            />
          </div>
        </CardContent>
      </Card>

      {/* Write doors — schedule a pasada (fires a task), re-plan around rain
          (append-only supersede), log a maturation signal. The client island holds
          the interactivity; this Server Component just feeds it the read-model rows. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-fg">
          {t("harvestPlanner.lead")}
        </p>
        <PlanActions
          plots={readiness.map((r) => ({ plotId: r.plotId, plotName: r.plotName }))}
          plans={calendar.map((p) => ({
            id: p.id,
            plotId: p.plotId,
            plotName: p.plotName,
            season: p.season,
            pasadaNumber: p.pasadaNumber,
          }))}
        />
      </div>

      {/* Two columns: readiness rank (left) + pasada timeline (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-label={t("harvestPlanner.readinessRankingLabel")}>
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
            {t("harvestPlanner.readinessHeading")}
          </h2>
          <ReadinessList rows={readiness} />
        </section>
        <section className="lg:col-span-2" aria-label={t("harvestPlanner.pasadaCalendarLabel")}>
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
            {t("harvestPlanner.pasadaCalendarHeading")}
          </h2>
          <PasadaTimeline plans={calendar} />
        </section>
      </div>
    </div>
  );
}
