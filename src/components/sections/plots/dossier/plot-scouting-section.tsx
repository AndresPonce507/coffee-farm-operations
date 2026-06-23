import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { IpmThresholdStatus } from "@/lib/types";

/* The /plots/[id] dossier's scouting section — the latest economic-threshold
 * call per pest (recommend control vs hold). Pure Server Component. The verdict
 * carries text + tone (never colour alone) for AA. */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
  });

const pct = (n: number) => `${n.toLocaleString("es-PA")} %`;

export function PlotScoutingSection({
  scouting,
}: {
  scouting: IpmThresholdStatus[];
}) {
  return (
    <DossierSection
      id="scouting"
      title="Monitoreo de plagas"
      count={scouting.length}
      empty={scouting.length === 0}
      emptyLabel="Sin monitoreo registrado todavía"
    >
      <Card>
        <CardContent className="px-0 py-1">
          <ul className="divide-y divide-line">
            {scouting.map((s) => (
              <li
                key={`${s.pestKind}-${s.observedAt}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
              >
                <span className="w-16 text-sm font-medium text-muted-fg">
                  {fmtDate(s.observedAt)}
                </span>
                <span className="font-display text-sm font-semibold capitalize text-ink">
                  {s.pestKind}
                </span>
                <span className="text-sm text-muted-fg">
                  incidencia {pct(s.incidencePct)}
                  {s.threshold != null && ` (umbral ${pct(s.threshold)})`}
                </span>
                <span className="ml-auto">
                  {s.recommend ? (
                    <Badge tone="danger" dot>
                      Recomienda control
                    </Badge>
                  ) : (
                    <Badge tone="ok" dot>
                      Mantener
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
