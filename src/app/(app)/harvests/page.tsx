import { PageHeader } from "@/components/ui/page-header";
import { HarvestSummary } from "@/components/sections/harvests/harvest-summary";
import { HarvestTrendCard } from "@/components/sections/harvests/harvest-trend-card";
import { TopPickersCard } from "@/components/sections/harvests/top-pickers-card";
import { HarvestLogTable } from "@/components/sections/harvests/harvest-log-table";

/**
 * /harvests — the daily picking ledger for the farm.
 *
 * Pure server component: composes the harvest sections (KPI summary, daily
 * trend, picker leaderboard, and the traceability log) into the shared app
 * shell provided by (app)/layout.tsx. All figures are derived deterministically
 * from the mock harvest anchor inside each section, so the page itself holds no
 * state and takes no props.
 */
export default function HarvestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Harvests"
        subtitle="Daily cherry intake and picker performance"
      />

      <HarvestSummary />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HarvestTrendCard />
        </div>
        <TopPickersCard />
      </div>

      <HarvestLogTable />
    </div>
  );
}
