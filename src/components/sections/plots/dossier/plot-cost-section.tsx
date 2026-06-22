import { ArrowUpRight } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import type { LotCost } from "@/lib/types";

/* The /plots/[id] dossier's cost-per-kg section. cost-per-kg-green is a COMPUTED
 * value — per the smart-bar rule you can't edit it, so it DRILLS to the editable
 * source records (the cost-entry ledger anchor #cost-entries on this same
 * dossier). A null verdict shows an honest em-dash (the green-kg denominator is
 * 0/undeclared), never a fabricated 0. Pure Server Component. */

const usd = (n: number) =>
  n.toLocaleString("es-PA", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

export function PlotCostSection({
  cost,
  plotId,
}: {
  cost: LotCost;
  plotId: string;
}) {
  return (
    <DossierSection id="cost" title="Costo por kg">
      <Card>
        <CardContent className="px-5 py-5">
          {cost.costPerKgGreen != null ? (
            <EntityLink
              kind="plot"
              id={plotId}
              anchor="cost-entries"
              className="group inline-flex items-baseline gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
            >
              <span className="font-display text-3xl font-bold text-ink">
                {usd(cost.costPerKgGreen)}
              </span>
              <span className="text-sm text-muted-fg">/ kg verde</span>
              <ArrowUpRight
                className="h-4 w-4 text-forest opacity-60 transition group-hover:opacity-100"
                aria-hidden
              />
            </EntityLink>
          ) : (
            <p className="font-display text-3xl font-bold text-muted-fg">—</p>
          )}
          <p className="mt-2 text-sm text-muted-fg">
            Ver los asientos de costo que producen esta cifra.
          </p>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
