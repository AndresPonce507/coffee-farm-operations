import { Check, X, MapPin, FileText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { EUDR_CUTOFF, type LotEudrDossier } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DeclarePlotForm } from "./declare-plot-form";
import { EudrStatusBadge } from "./eudr-status-badge";

/** A compliance fact chip — a green check or a red cross, label, never color
 *  alone (the icon + text carry the state). */
function FactChip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1",
        ok
          ? "bg-forest-100 text-forest ring-forest/15"
          : "bg-cherry-100 text-cherry ring-cherry/15",
      )}
    >
      {ok ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <X className="h-3 w-3" aria-hidden />
      )}
      {children}
    </span>
  );
}

/** [lng, lat] → a compact, human "8.7780, -82.6403" geolocation readout. */
function formatCentroid(centroid: [number, number] | null): string {
  if (!centroid) return "—";
  const [lng, lat] = centroid;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/**
 * EudrDossier — a green lot's EU Deforestation Regulation due-diligence dossier:
 * the headline verdict + the plots of origin, each with its geolocation and
 * deforestation-free status. The buyer/auditor artifact that makes "provenance
 * IS the product" legally legible. Pure presentation (props-driven, no data
 * deps): the page resolves `getLotEudrDossier(code)` and hands it down.
 *
 * The verdict is the authoritative eudr_lot_status() value; the per-plot facts
 * below it are the SAME rows the verdict is computed from, so the badge and the
 * list can never disagree. A 'no-origin' lot shows the honest "lineage doesn't
 * reach a harvested plot" state — never a fabricated green tick.
 */
export function EudrDossier({
  dossier,
  className,
}: {
  dossier: LotEudrDossier;
  className?: string;
}) {
  const { code, status, originPlots } = dossier;

  return (
    <Card className={cn("animate-rise", className)}>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              EUDR due-diligence dossier
            </h3>
            <p className="mt-0.5 text-xs text-muted-fg">
              Plots of origin · deforestation-free since {EUDR_CUTOFF}
            </p>
          </div>
          <EudrStatusBadge status={status} />
        </div>

        {originPlots.length === 0 ? (
          <p
            data-testid="eudr-no-origin"
            className="rounded-lg bg-cherry-100/50 px-3 py-3 text-xs text-cherry ring-1 ring-cherry/15"
          >
            This lot&apos;s lineage doesn&apos;t reach a harvested plot, so its
            origin can&apos;t yet be substantiated. Link the source lots&apos;
            harvests to place it under EUDR due diligence.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="eudr-origin-plots">
            {originPlots.map((p) => (
              <li
                key={p.plotId}
                data-testid={`eudr-origin-${p.plotId}`}
                className="rounded-lg bg-card px-3 py-2 ring-1 ring-black/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <EntityLink
                    kind="plot"
                    id={p.plotId}
                    className="truncate text-sm font-medium text-ink underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-forest/30"
                  >
                    {p.plotName}
                  </EntityLink>
                  <span className="shrink-0 text-[11px] text-muted-fg">
                    est. {p.establishedYear}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <FactChip ok={p.geolocated}>
                    <MapPin className="h-3 w-3" aria-hidden />
                    {p.geolocated ? formatCentroid(p.centroid) : "Not geolocated"}
                  </FactChip>
                  <FactChip ok={p.deforestationFree}>
                    {p.deforestationFree
                      ? `Deforestation-free${p.declBasis ? ` · ${p.declBasis}` : ""}`
                      : "Undeclared"}
                  </FactChip>
                </div>
                {/* The owner's WRITE seam: declare an UNdeclared plot
                    deforestation-free (the verdict re-renders from the SSOT).
                    A declared plot shows no button — withdraw is out of scope. */}
                {!p.deforestationFree && (
                  <DeclarePlotForm
                    plotId={p.plotId}
                    establishedYear={p.establishedYear}
                    lotCode={code}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-muted-fg">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Geolocation + deforestation-free declaration per plot of production
          (EU Regulation 2023/1115).
        </p>
      </CardContent>
    </Card>
  );
}
