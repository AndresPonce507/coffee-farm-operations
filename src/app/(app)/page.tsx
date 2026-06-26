import { SeasonHero } from "@/components/sections/dashboard/season-hero";
import { KpiRow } from "@/components/sections/dashboard/kpi-row";
import { YieldTrendCard } from "@/components/sections/dashboard/yield-trend-card";
import { VarietyMixCard } from "@/components/sections/dashboard/variety-mix-card";
import { ActivityFeedCard } from "@/components/sections/dashboard/activity-feed-card";
import { WeatherStripCard } from "@/components/sections/dashboard/weather-strip-card";
import { PlotHealthCard } from "@/components/sections/dashboard/plot-health-card";
import { ProcessingPipelineCard } from "@/components/sections/dashboard/processing-pipeline-card";

/**
 * Dashboard — the Coffee Farm Operations home ("/").
 *
 * SeasonHero serves as the page header (no PageHeader), followed by the four
 * headline KPIs. Below, a 12-column responsive grid: the left two columns lead
 * with the yield trend then pair plot health with the processing pipeline,
 * while the right rail stacks the variety mix, weather, and recent activity.
 *
 * Pure server component — every section derives live from the append-only
 * truth (the Dashboard "today"/season headline reads season_summary_view, which
 * sums `harvests` on the latest date), so a single weigh-in ripples here with
 * zero re-entry. No props, no client-side state.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <SeasonHero />

      <KpiRow />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left rail — spans two of the three columns */}
        <div className="space-y-6 lg:col-span-2">
          <YieldTrendCard />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <PlotHealthCard />
            <ProcessingPipelineCard />
          </div>
        </div>

        {/* Right rail — single column */}
        <div className="space-y-6">
          <VarietyMixCard />
          <WeatherStripCard />
          <ActivityFeedCard />
        </div>
      </div>
    </div>
  );
}
