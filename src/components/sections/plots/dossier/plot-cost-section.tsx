import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import type { LotCost } from "@/lib/types";

/* The /plots/[id] dossier's cost-per-kg section. cost-per-kg-green is a COMPUTED
 * value — per the smart-bar rule you can't edit it, so it DRILLS to the editable
 * source records (the #cost section on this same dossier — DossierSection id="cost").
 * A null verdict shows an honest em-dash (the green-kg denominator is
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
  const t = useTranslations("plots");
  return (
    <DossierSection id="cost" title={t("cost.title")}>
      <Card>
        <CardContent className="px-5 py-5">
          {cost.costPerKgGreen != null ? (
            <EntityLink
              kind="plot"
              id={plotId}
              anchor="cost"
              className="group inline-flex items-baseline gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
            >
              <span className="font-display text-3xl font-bold text-ink">
                {usd(cost.costPerKgGreen)}
              </span>
              <span className="text-sm text-muted-fg">{t("cost.perKgGreen")}</span>
              <ArrowUpRight
                className="h-4 w-4 text-forest opacity-60 transition group-hover:opacity-100"
                aria-hidden
              />
            </EntityLink>
          ) : (
            <p className="font-display text-3xl font-bold text-muted-fg">—</p>
          )}
          <p className="mt-2 text-sm text-muted-fg">
            {t("cost.drillHint")}
          </p>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
