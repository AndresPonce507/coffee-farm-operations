import { PageHeader } from "@/components/ui/page-header";
import { AtpTable } from "@/components/sections/inventory/atp-table";
import { getGreenLotAtp } from "@/lib/db/greenlots";

/**
 * Inventory — the "/inventory" route for Coffee Farm Operations (S5, the first
 * money-shaped slice).
 *
 * Where the pipeline used to dead-end at green, this surface treats a graded lot
 * as a located, available-to-promise sellable asset: a dense glass table of every
 * green lot with a per-row dual-bar ATP meter (committed vs available) and a
 * reservation drawer to hold kg against a buyer.
 *
 * Server Component: it awaits the DERIVED `green_lots_atp` read port once
 * (`atp = current − Σreserved − Σshipped`, computed in the view so it can never
 * disagree with the claim rows it sums) and composes the header above the table.
 * The only client JS is the reservation drawer island inside the table. The app
 * shell (sidebar, topbar, padded main) comes from (app)/layout.tsx.
 */
export default async function InventoryPage() {
  const atp = await getGreenLotAtp();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Green coffee, graded and available to promise"
      />

      <AtpTable rows={atp} />
    </div>
  );
}
