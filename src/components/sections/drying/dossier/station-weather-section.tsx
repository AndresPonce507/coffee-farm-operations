import { CloudRain, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Badge } from "@/components/ui/badge";
import type { DryingWeatherRisk } from "@/lib/types";

/**
 * DryingStationWeatherSection — the station's upcoming weather-cover forecast. Each
 * day is a chip; a high-rain day on an open-air bed reads as a "cover" risk (cherry)
 * vs a clear day (sky) — the closed-loop signal that an open station should be covered.
 * Wraps in `<DossierSection id="weather">`. Empty for covered stations (no risk feed).
 */
export function DryingStationWeatherSection({
  risk,
}: {
  risk: DryingWeatherRisk[];
}) {
  const t = useTranslations("drying");
  return (
    <DossierSection
      id="weather"
      title={t("stationDossier.weatherTitle")}
      count={risk.length}
      empty={risk.length === 0}
      emptyLabel={t("stationDossier.weatherEmpty")}
    >
      <ul role="list" className="flex flex-wrap gap-2">
        {risk.map((r) => (
          <li key={r.forecastOrder}>
            <Badge tone={r.coverRisk ? "cherry" : "sky"} dot={r.coverRisk}>
              {r.coverRisk ? (
                <CloudRain aria-hidden className="h-3 w-3" />
              ) : (
                <Sun aria-hidden className="h-3 w-3" />
              )}
              {r.day} · {t("stationDossier.rainPct", { pct: r.rainPct })}
            </Badge>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
