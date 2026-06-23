import { PageHeader } from "@/components/ui/page-header";
import { CostingSummary } from "@/components/sections/costing/costing-summary";
import { CostLotList } from "@/components/sections/costing/cost-lot-list";
import { BookCostButton } from "@/components/sections/costing/cost-entry-form";
import {
  getGreenReachableLots,
  getGreenReachablePlots,
} from "@/lib/db/cogs";

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
 * It is fed the GREEN-REACHABLE lot-code + plot lists — only targets whose money
 * actually reaches a green terminal (and thus cost-per-kg-green); a cost booked
 * onto a lot/plot that reaches no green inventory would silently vanish from
 * COGS, so the picker never offers one. A farm-wide overhead carries no target.
 * Corrections (reversing entries) remain a follow-up.
 *
 * Server Component (no client JS in the read sections): all data flows from the
 * cogs + greenlots read ports; the matview-backed `cogs_per_lot` RPC is the SSOT
 * for each verdict, the ledger is the audit trail behind it — nothing here
 * re-implements the COGS sum.
 */
export default async function CostingPage() {
  const [lots, plots] = await Promise.all([
    getGreenReachableLots(),
    getGreenReachablePlots(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costos"
        subtitle="Costo real por kg de verde — el número del que vive la finca"
      >
        <BookCostButton lots={lots} plots={plots} />
      </PageHeader>

      <CostingSummary />

      <CostLotList />
    </div>
  );
}
