import { PageHeader } from "@/components/ui/page-header";
import { getPlots } from "@/lib/db/plots";
import { getPickers } from "@/lib/db/workers";
import { getHarvestableLots } from "@/lib/db/harvestable-lots";
import { HarvestSummary } from "@/components/sections/harvests/harvest-summary";
import { HarvestTrendCard } from "@/components/sections/harvests/harvest-trend-card";
import { TopPickersCard } from "@/components/sections/harvests/top-pickers-card";
import { HarvestLogTable } from "@/components/sections/harvests/harvest-log-table";
import { AddHarvestButton } from "@/components/sections/harvests/harvest-actions";
import { RecordIntakeButton } from "@/components/sections/harvests/record-intake-button";

/**
 * /harvests — the daily picking ledger for the farm.
 *
 * Server component: fetches the plot, picker, and lot-code lists once (for the
 * create/edit forms) and composes the header (with the live "Log harvest"
 * action), the KPI summary, daily trend, picker leaderboard, and the editable
 * traceability log.
 */
export default async function HarvestsPage() {
  // Only lots that can take fresh cherry intake (cherry-stage / unstaged) — never
  // green export or milled source lots (FINDING #35). Feeds both the "Log harvest"
  // form and the per-row edit form so neither can target a green/milled lot.
  const [plots, pickers, lots] = await Promise.all([
    getPlots(),
    getPickers(),
    getHarvestableLots(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harvests"
        subtitle="Daily cherry intake and picker performance"
      >
        {/* The genesis WRITE — mints a traceable JC-NNN lot the whole spine
            reads (COGS / EUDR / inventory) — sits as the primary action,
            alongside the simple `harvests`-row "Log harvest" path. */}
        <RecordIntakeButton plots={plots} pickers={pickers} />
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
