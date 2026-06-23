import { MapPin } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { Badge } from "@/components/ui/badge";
import type { CrewAssignedPlot } from "@/lib/db/dossier/crew";

/**
 * CrewPlotsSection — the crew dossier's "assigned plots" section.
 *
 * Pure presentational Server Component. Receives the distinct plots this crew is
 * dispatched to (derived from its dispatch history) and renders each as a glass
 * card whose NAME is an `<EntityLink kind="plot">` to that plot's /plots/[id]
 * dossier (P6). Each card carries the variety, altitude, how many of the crew's
 * runs include it, and the most-recent morning it was sent — so the section
 * reads as "where this crew works". Wraps its body in
 * `<DossierSection id="plots">` for /crew/[id]#plots deep-linking.
 */
export function CrewPlotsSection({
  plots,
}: {
  plots: CrewAssignedPlot[];
}) {
  return (
    <DossierSection
      id="plots"
      title="Lotes asignados"
      count={plots.length}
      empty={plots.length === 0}
      emptyLabel="Esta cuadrilla aún no ha sido despachada a ningún lote"
    >
      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plots.map((plot) => (
          <li key={plot.plotId}>
            <EntityLink
              kind="plot"
              id={plot.plotId}
              name={plot.plotId}
              className="glass-card glass-hover flex items-start gap-3 rounded-2xl p-3.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-100 text-forest"
              >
                <MapPin className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold text-ink">
                  {plot.plotName}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-fg">
                  {plot.variety} · {plot.altitudeMasl.toLocaleString("es-PA")}{" "}
                  msnm
                </p>
                <p className="mt-1 text-[11px] text-muted-fg">
                  Último despacho: {plot.lastDispatchDate}
                </p>
              </div>
              <Badge tone="forest" className="shrink-0">
                {plot.runCount}{" "}
                {plot.runCount === 1 ? "despacho" : "despachos"}
              </Badge>
            </EntityLink>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
