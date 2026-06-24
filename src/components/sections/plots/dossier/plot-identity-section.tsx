import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Plot, PlotStatus } from "@/lib/types";

/* The /plots/[id] dossier's identity + geometry section. Pure presentational
 * Server Component: takes the already-resolved anchor Plot, renders its
 * geometry facts (variety, area, altitude, trees, shade, established). No
 * fetch, no client JS. The status pill carries text + tone (never colour
 * alone) for AA. */

/** Status → its translation key under plots.identity.status. */
const STATUS_KEY: Record<PlotStatus, string> = {
  healthy: "healthy",
  watch: "watch",
  "at-risk": "atRisk",
};
const STATUS_TONE: Record<PlotStatus, BadgeTone> = {
  healthy: "ok",
  watch: "warn",
  "at-risk": "danger",
};

const num = (n: number) => n.toLocaleString("es-PA");

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-base font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

export function PlotIdentitySection({ plot }: { plot: Plot }) {
  const t = useTranslations("plots");
  return (
    <DossierSection id="identity" title={t("identity.title")}>
      <Card>
        <CardContent className="px-5 py-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="forest">{plot.block}</Badge>
            <Badge tone={STATUS_TONE[plot.status]} dot>
              {t(`identity.status.${STATUS_KEY[plot.status]}`)}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label={t("identity.variety")} value={plot.variety} />
            <Fact label={t("identity.area")} value={`${num(plot.areaHa)} ha`} />
            <Fact label={t("identity.altitude")} value={`${num(plot.altitudeMasl)} msnm`} />
            <Fact label={t("identity.trees")} value={num(plot.trees)} />
            <Fact label={t("identity.shade")} value={`${num(plot.shadePct)} %`} />
            <Fact label={t("identity.established")} value={num(plot.establishedYear)} />
          </dl>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
