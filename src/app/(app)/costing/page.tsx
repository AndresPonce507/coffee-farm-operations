import { PageHeader } from "@/components/ui/page-header";
import { CostingSummary } from "@/components/sections/costing/costing-summary";
import { CostLotList } from "@/components/sections/costing/cost-lot-list";

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
 * Server Component (no client JS): all data flows from the cogs + greenlots read
 * ports; the matview-backed `cogs_per_lot` RPC is the SSOT for each verdict, the
 * ledger is the audit trail behind it — nothing here re-implements the COGS sum.
 * The app shell (sidebar, topbar, padded main) is provided by (app)/layout.tsx;
 * this page renders only its inner content.
 */
export default function CostingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Costing"
        subtitle="True cost-per-kg-green — the number the farm turns on"
      />

      <CostingSummary />

      <CostLotList />
    </div>
  );
}
