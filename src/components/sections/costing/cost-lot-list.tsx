import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { getCostBreakdownByRule, getLotCost } from "@/lib/db/cogs";
import { getGreenLotAtp } from "@/lib/db/greenlots";

import { CostLotCard } from "./cost-lot-card";

/**
 * CostLotList — the S7 dogfood: every green lot's true cost-per-kg-green, laid
 * out as a stagger-revealed grid of `CostLotCard`s.
 *
 * Server Component (no client JS): fetches the green-lot inventory (the green-kg
 * denominator per lot, the terminal graph mass) once, then in parallel resolves
 * each lot's RPC cost verdict (`getLotCost`) and its FULLY-ALLOCATED per-rule
 * breakdown (`getCostBreakdownByRule` → cogs_breakdown_per_lot). Both come from
 * the same matview, so the card's build-up reconciles to its headline exactly —
 * nothing here re-implements the COGS sum; the verdict is the SSOT and the
 * per-rule breakdown is the same allocation, just split by rule.
 */
export async function CostLotList() {
  const t = await getTranslations("costing");
  const lots = await getGreenLotAtp();

  if (lots.length === 0) {
    return (
      <Card data-testid="costing-empty" className="animate-rise">
        <CardContent className="py-12 text-center text-sm text-muted-fg">
          {t("lotList.emptyTitle")}
        </CardContent>
      </Card>
    );
  }

  // Per lot: the scalar cost verdict + its per-rule allocated breakdown, fetched
  // together (both off mv_lot_cost*, so they reconcile by construction).
  const costed = await Promise.all(
    lots.map(async (lot) => {
      const [cost, breakdown] = await Promise.all([
        getLotCost(lot.greenLotCode),
        getCostBreakdownByRule(lot.greenLotCode),
      ]);
      return { lot, cost, breakdown };
    }),
  );

  return (
    <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {costed.map(({ lot, cost, breakdown }) => (
        <CostLotCard
          key={lot.greenLotCode}
          code={lot.greenLotCode}
          costPerKgGreen={cost.costPerKgGreen}
          greenKg={lot.currentKg}
          breakdown={breakdown}
        />
      ))}
    </div>
  );
}
