import { PageHeader } from "@/components/ui/page-header";
import { PlotsSummary } from "@/components/sections/plots/plots-summary";
import { PlotsExplorer } from "@/components/sections/plots/plots-explorer";
import { PlotsTable } from "@/components/sections/plots/plots-table";

/**
 * /plots — overview of every growing lot across Janson's farms in Volcán.
 * Server component: PlotsExplorer is the only client (interactive) section.
 */
export default function PlotsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Plots"
        subtitle="Growing lots across Janson’s farms in Volcán, Chiriquí"
      />
      <PlotsSummary />
      <PlotsExplorer />
      <PlotsTable />
    </div>
  );
}
