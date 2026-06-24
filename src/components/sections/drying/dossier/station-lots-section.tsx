import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { Badge } from "@/components/ui/badge";
import type { DryingLot } from "@/lib/types";

/**
 * DryingStationLotsSection — the lots currently resting on this station. Each lot
 * code is an `<EntityLink kind="lot">` to its lot dossier (P6 cross-link OUT), with
 * its variety, latest moisture, days resting, and the reposo-gate verdict. Wraps in
 * `<DossierSection id="lots">` for /drying-station/[id]#lots deep-linking.
 */
export function DryingStationLotsSection({ lots }: { lots: DryingLot[] }) {
  const t = useTranslations("drying");
  return (
    <DossierSection
      id="lots"
      title={t("stationDossier.lotsTitle")}
      count={lots.length}
      empty={lots.length === 0}
      emptyLabel={t("stationDossier.lotsEmpty")}
    >
      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {lots.map((lot) => (
          <li key={lot.lotCode}>
            <EntityLink
              kind="lot"
              id={lot.lotCode}
              name={lot.lotCode}
              className="glass-card glass-hover flex items-start justify-between gap-3 rounded-2xl p-3.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-ink">
                  {lot.lotCode}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-fg">
                  {lot.variety ? `${lot.variety} · ` : ""}
                  {lot.reposo.latestMoisture != null
                    ? t("stationDossier.lotMoisture", { pct: lot.reposo.latestMoisture })
                    : t("stationDossier.lotNoMoisture")}
                </p>
                {lot.reposo.restDaysElapsed != null && (
                  <p className="mt-1 text-[11px] text-muted-fg">
                    {t("stationDossier.lotResting", { days: lot.reposo.restDaysElapsed })}
                  </p>
                )}
              </div>
              <Badge tone={lot.reposo.ready ? "forest" : "honey"} className="shrink-0">
                {lot.reposo.ready
                  ? t("stationDossier.lotReady")
                  : t("stationDossier.lotRestingBadge")}
              </Badge>
            </EntityLink>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
