import { Check, X, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import { EUDR_CUTOFF, type PlotOriginStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The /plots/[id] dossier's EUDR-origin section — this plot's own
 * due-diligence facts (geolocation + deforestation-free declaration) plus each
 * GREEN LOT its cherries feed, linked → /lots/[code]#eudr (cross-entity link,
 * P6 — the lot dossiers that depend on this plot's compliance). A null status
 * is an honest "feeds no green lot" empty (never a fabricated pass). Pure
 * Server Component; facts carry icon + text, never colour alone (AA). */

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

function formatCentroid(centroid: [number, number] | null): string {
  if (!centroid) return "—";
  const [lng, lat] = centroid;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export function PlotEudrSection({
  status,
}: {
  status: PlotOriginStatus | null;
}) {
  const t = useTranslations("plots");
  if (!status) {
    return (
      <DossierSection
        id="eudr"
        title={t("eudr.title")}
        empty
        emptyLabel={t("eudr.empty")}
      >
        {null}
      </DossierSection>
    );
  }

  return (
    <DossierSection id="eudr" title={t("eudr.title")}>
      <Card>
        <CardContent className="space-y-4 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <FactChip ok={status.geolocated}>
              {status.geolocated
                ? t("eudr.geolocated")
                : t("eudr.notGeolocated")}
            </FactChip>
            <FactChip ok={status.deforestationFree}>
              {status.deforestationFree
                ? t("eudr.deforestationFree")
                : t("eudr.noDeclaration")}
            </FactChip>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                {t("eudr.established")}
              </dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {status.establishedYear}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                {t("eudr.centroid")}
              </dt>
              <dd className="mt-0.5 inline-flex items-center gap-1 font-semibold text-ink">
                <MapPin className="h-3.5 w-3.5 text-forest" aria-hidden />
                {formatCentroid(status.centroid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                {t("eudr.cutoff")}
              </dt>
              <dd className="mt-0.5 font-semibold text-ink">{EUDR_CUTOFF}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-fg">
              {t("eudr.feedsLots")}
            </p>
            <div className="flex flex-wrap gap-2">
              {status.feedsLots.map((code) => (
                <EntityLink
                  key={code}
                  kind="lot"
                  id={code}
                  anchor="eudr"
                  className="rounded-md bg-coffee-200/40 px-2 py-1 text-sm font-medium text-coffee underline-offset-2 hover:underline"
                >
                  {code}
                </EntityLink>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
