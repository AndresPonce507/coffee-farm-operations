import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Plot, PlotStatus } from "@/lib/types";

/* The /plots/[id] dossier's identity + geometry section. Pure presentational
 * Server Component: takes the already-resolved anchor Plot, renders its
 * geometry facts (variety, area, altitude, trees, shade, established). No
 * fetch, no client JS. The status pill carries text + tone (never colour
 * alone) for AA. */

const STATUS_LABEL: Record<PlotStatus, string> = {
  healthy: "Saludable",
  watch: "En observación",
  "at-risk": "En riesgo",
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
  return (
    <DossierSection id="identity" title="Identidad y geometría">
      <Card>
        <CardContent className="px-5 py-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="forest">{plot.block}</Badge>
            <Badge tone={STATUS_TONE[plot.status]} dot>
              {STATUS_LABEL[plot.status]}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label="Variedad" value={plot.variety} />
            <Fact label="Área" value={`${num(plot.areaHa)} ha`} />
            <Fact label="Altitud" value={`${num(plot.altitudeMasl)} msnm`} />
            <Fact label="Árboles" value={num(plot.trees)} />
            <Fact label="Sombra" value={`${num(plot.shadePct)} %`} />
            <Fact label="Establecido" value={num(plot.establishedYear)} />
          </dl>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
