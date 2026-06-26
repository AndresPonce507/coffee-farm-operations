import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import type { PlotYield } from "@/lib/db/dossier/plot";

/* The /plots/[id] dossier's yield section — the season target vs harvested-kg
 * progress. The harvested total is a COMPUTED rollup of the plot's harvest
 * records, so it DRILLS (smart-bar) to the editable source: the #harvests
 * section on this same dossier. `pct` is null when the target is undeclared →
 * honest em-dash, never a fabricated 0%. Pure Server Component. */

const num = (n: number) => n.toLocaleString("es-PA");

export function PlotYieldSection({
  yield: yld,
  plotId,
}: {
  yield: PlotYield;
  plotId: string;
}) {
  const t = useTranslations("plots");
  const clamped =
    yld.pct == null ? 0 : Math.max(0, Math.min(100, yld.pct));

  return (
    <DossierSection id="yield" title={t("yield.title")}>
      <Card>
        <CardContent className="space-y-4 px-5 py-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <EntityLink
              kind="plot"
              id={plotId}
              anchor="harvests"
              className="group inline-flex items-baseline gap-1.5 rounded-lg font-display text-2xl font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
            >
              {num(yld.harvestedKg)} kg
              <ArrowUpRight
                className="h-4 w-4 self-center text-forest opacity-60 transition group-hover:opacity-100"
                aria-hidden
              />
            </EntityLink>
            <span className="text-sm text-muted-fg">
              {t("yield.ofTarget", { kg: num(yld.expectedYieldKg) })}
            </span>
            <span className="ml-auto font-display text-lg font-semibold text-forest">
              {yld.pct == null ? "—" : `${num(Math.round(yld.pct))} %`}
            </span>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full bg-forest-100"
            role="progressbar"
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("yield.progressAria")}
          >
            <div
              className="h-full rounded-full bg-forest transition-[width]"
              style={{ width: `${clamped}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
