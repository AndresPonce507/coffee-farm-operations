import { PageHeader } from "@/components/ui/page-header";
import { CostingSummary } from "@/components/sections/costing/costing-summary";
import { CostLotList } from "@/components/sections/costing/cost-lot-list";
import { BookCostButton } from "@/components/sections/costing/cost-entry-form";
import { getLots } from "@/lib/db/lots";
import { getPlots } from "@/lib/db/plots";

/**
 * Costing — the "/costing" route for Coffee Farm Operations (S7).
 *
 * Activity-based COGS made visible: the true cost-per-kg-green per lot — the
 * number the business actually turns on. A divided strip of headline numbers
 * (CostingSummary: green priced, lots costed, green-kg-weighted average, the
 * cheapest lot), then the per-lot cost cards (CostLotList) — each a
 * `CostWaterfall` build-up + `CostDecomposition` bar over the four documented
 * allocation rules (labor | processing | agronomy | overhead), with every
 * figure resolvable to its append-only `cost_entry` provenance.
 *
 * The header now carries the WRITE affordance — `BookCostButton` opens a form
 * that appends a NEW cost to the `cost_entry` ledger (the only legal write is an
 * append; the action refreshes the matview so the new cost shows immediately).
 * It is fed the lot-code + plot lists so a plot/lot-targeted cost names a real
 * target; a farm-wide overhead carries none. Corrections (reversing entries)
 * remain a follow-up.
 *
 * Server Component (no client JS in the read sections): all data flows from the
 * cogs + greenlots read ports; the matview-backed `cogs_per_lot` RPC is the SSOT
 * for each verdict, the ledger is the audit trail behind it — nothing here
 * re-implements the COGS sum.
 */
export default async function CostingPage() {
  const [lots, plots] = await Promise.all([getLots(), getPlots()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costing"
        subtitle="True cost-per-kg-green — the number the farm turns on"
      >
        <BookCostButton lots={lots} plots={plots} />
      </PageHeader>

      <CostingSummary />

      <CostLotList />
    </div>
  );
}
