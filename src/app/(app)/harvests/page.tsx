import { PageHeader } from "@/components/ui/page-header";
import { getPlots } from "@/lib/db/plots";
import { getPickers } from "@/lib/db/workers";
import { getLots } from "@/lib/db/lots";
import { HarvestSummary } from "@/components/sections/harvests/harvest-summary";
import { HarvestTrendCard } from "@/components/sections/harvests/harvest-trend-card";
import { TopPickersCard } from "@/components/sections/harvests/top-pickers-card";
import { HarvestLogTable } from "@/components/sections/harvests/harvest-log-table";
import { AddHarvestButton } from "@/components/sections/harvests/harvest-actions";

/**
 * /harvests — the daily picking ledger for the farm.
 *
 * Server component: fetches the plot, picker, and lot-code lists once (for the
 * create/edit forms) and composes the header (with the live "Log harvest"
 * action), the KPI summary, daily trend, picker leaderboard, and the editable
 * traceability log.
 */
export default async function HarvestsPage() {
  const [plots, pickers, lots] = await Promise.all([
    getPlots(),
    getPickers(),
    getLots(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harvests"
        subtitle="Daily cherry intake and picker performance"
      >
        <AddHarvestButton plots={plots} pickers={pickers} lots={lots} />
      </PageHeader>

      <HarvestSummary />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HarvestTrendCard />
        </div>
        <TopPickersCard />
      </div>

      <HarvestLogTable plots={plots} pickers={pickers} lots={lots} />
    </div>
  );
}
