import { ShieldAlert, ShieldCheck } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import type { PlotPhiStatus, SprayLogEntry } from "@/lib/types";

/* The /plots/[id] dossier's sprays + PHI-status section. Surfaces any ACTIVE
 * pre-harvest-interval window (the harvest block) up top, then the append-only
 * spray log — each application linking its certified applicator → /workers/[id]
 * (cross-entity link, P6). Pure Server Component. */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
  });

export function PlotSpraySection({
  phi,
  sprays,
}: {
  phi: PlotPhiStatus[];
  sprays: SprayLogEntry[];
}) {
  const activePhi = phi.filter((p) => p.phiActive || p.reiActive);
  // The soonest the plot is fully clear to pick/enter again — the headline date
  // for the harvest-block warning. The per-product detail lives in the log below
  // (so the product name is surfaced ONCE, not duplicated between block + log).
  const clearsOn = activePhi
    .map((p) => p.phiClearsOn)
    .sort()
    .at(-1);

  return (
    <DossierSection
      id="sprays"
      title="Aplicaciones y estado PHI"
      count={sprays.length}
      empty={sprays.length === 0 && phi.length === 0}
      emptyLabel="Sin aplicaciones registradas"
    >
      <div className="space-y-3">
        {activePhi.length > 0 ? (
          <Card className="border-honey/30">
            <CardContent className="flex items-start gap-3 px-5 py-4">
              <ShieldAlert
                className="mt-0.5 h-5 w-5 shrink-0 text-honey-700"
                aria-hidden
              />
              <div className="space-y-1">
                <p className="font-display text-sm font-semibold text-ink">
                  Intervalo activo — no cosechar
                  {clearsOn ? ` hasta el ${fmtDate(clearsOn)}` : ""}
                </p>
                <p className="text-sm text-muted-fg">
                  {activePhi.length === 1
                    ? "1 aplicación con intervalo de pre-cosecha vigente — ver detalle abajo."
                    : `${activePhi.length} aplicaciones con intervalo de pre-cosecha vigente — ver detalle abajo.`}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : sprays.length > 0 ? (
          <Card className="border-forest/20">
            <CardContent className="flex items-center gap-2 px-5 py-3 text-sm text-forest">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Sin intervalos activos — la parcela está libre para cosechar
            </CardContent>
          </Card>
        ) : null}

        {sprays.length > 0 && (
          <Card>
            <CardContent className="px-0 py-1">
              <ul className="divide-y divide-line">
                {sprays.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                  >
                    <span className="w-16 text-sm font-medium text-muted-fg">
                      {fmtDate(s.appliedAt)}
                    </span>
                    <span className="font-display text-sm font-semibold text-ink">
                      {s.product}
                    </span>
                    <Badge tone="neutral">PHI {s.phiDays} d</Badge>
                    <span className="ml-auto text-sm text-muted-fg">
                      <EntityLink
                        kind="worker"
                        id={s.workerId}
                        className="rounded-md font-medium text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                      >
                        {s.workerName}
                      </EntityLink>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </DossierSection>
  );
}
