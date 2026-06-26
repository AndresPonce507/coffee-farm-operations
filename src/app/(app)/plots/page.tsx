import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/page-header";
import { PlotsSummary } from "@/components/sections/plots/plots-summary";
import { PlotsExplorer } from "@/components/sections/plots/plots-explorer";
import { PlotsTable } from "@/components/sections/plots/plots-table";
import { AddPlotButton } from "@/components/sections/plots/plot-actions";
import { getPlots } from "@/lib/db/plots";

/**
 * /plots — overview of every growing lot across Janson's farms in Volcán.
 * Server component: PlotsExplorer is the only client (interactive) section;
 * the header carries the live "New plot" action.
 */
export default async function PlotsPage() {
  const t = await getTranslations("plots");
  const plots = await getPlots();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
      >
        <AddPlotButton />
      </PageHeader>
      <PlotsSummary />
      <PlotsExplorer plots={plots} />
      <PlotsTable />
    </div>
  );
}
