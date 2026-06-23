import { Coins, Layers, TrendingDown, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { EntityLink } from "@/components/ui/entity-link";
import { getLotCost } from "@/lib/db/cogs";
import { getGreenLotAtp } from "@/lib/db/greenlots";
import { kg, num, usd } from "@/lib/utils";

/**
 * CostingSummary — a divided strip of headline numbers for the activity-based
 * COGS surface. Server Component: pulls the green-lot inventory and each lot's
 * RPC cost verdict, then surfaces the figures the family actually turns on:
 *  - green-kg priced (the denominator the whole page divides by);
 *  - how many lots have a non-null cost verdict (lots with declared green-kg);
 *  - the green-kg-WEIGHTED average cost-per-kg-green across costed lots
 *    (Σcost·kg / Σkg — never a naive mean that ignores lot size);
 *  - the cheapest costed lot (the margin leader).
 *
 * Lots with no green-kg yet return a NULL verdict from the RPC and are excluded
 * from the average and the cheapest pick — never folded in as a fabricated 0.
 */
export async function CostingSummary() {
  const t = await getTranslations("costing");
  const lots = await getGreenLotAtp();
  const verdicts = await Promise.all(
    lots.map(async (lot) => ({
      code: lot.greenLotCode,
      greenKg: lot.currentKg,
      cost: (await getLotCost(lot.greenLotCode)).costPerKgGreen,
    })),
  );

  const costed = verdicts.filter(
    (v): v is { code: string; greenKg: number; cost: number } =>
      v.cost != null,
  );

  const totalGreenKg = lots.reduce((sum, l) => sum + l.currentKg, 0);

  // Green-kg-weighted average — a big cheap lot moves the farm number more than
  // a tiny expensive one (Σcost·kg / Σkg over the lots that actually have kg).
  const weightedKg = costed.reduce((sum, v) => sum + Math.max(v.greenKg, 0), 0);
  const weightedCostUsd = costed.reduce(
    (sum, v) => sum + v.cost * Math.max(v.greenKg, 0),
    0,
  );
  const avgCostPerKg = weightedKg > 0 ? weightedCostUsd / weightedKg : null;

  const cheapest =
    costed.length > 0
      ? costed.reduce((best, v) => (v.cost < best.cost ? v : best))
      : null;

  return (
    <Card className="animate-rise overflow-hidden">
      <CardContent className="p-0">
        <div className="stagger grid grid-cols-2 divide-y divide-white/50 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <Tile
            label={t("summary.greenPriced")}
            value={kg(totalGreenKg)}
            sub={t("summary.greenPricedSub")}
            accent="coffee"
            icon={Scale}
            className="glass-hover border-r border-white/50 lg:border-r-0"
          />
          <Tile
            label={t("summary.lotsCosted")}
            value={num(costed.length)}
            sub={t("summary.lotsCostedSub", { count: num(lots.length) })}
            accent="forest"
            icon={Layers}
            className="glass-hover"
          />
          <Tile
            label={t("summary.avgCostPerKg")}
            value={avgCostPerKg == null ? "—" : usd(avgCostPerKg, 2)}
            sub={t("summary.avgCostPerKgSub")}
            accent="honey"
            icon={Coins}
            className="glass-hover border-r border-white/50 lg:border-r-0"
          />
          {cheapest ? (
            <EntityLink
              kind="lot"
              id={cheapest.code}
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60 rounded-none"
            >
              <Tile
                label={t("summary.cheapestLot")}
                value={cheapest.code}
                sub={t("summary.cheapestLotSub", { cost: usd(cheapest.cost, 2) })}
                accent="sky"
                icon={TrendingDown}
                className="glass-hover"
              />
            </EntityLink>
          ) : (
            <Tile
              label={t("summary.cheapestLot")}
              value="—"
              sub={t("summary.noCostedLots")}
              accent="sky"
              icon={TrendingDown}
              className="glass-hover"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
