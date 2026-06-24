import { CloudRain, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { Badge } from "@/components/ui/badge";
import { weekdayKey } from "@/lib/drying/station-labels";
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
        {risk.map((r) => {
          // Localize the forecast day token so "Mon"/"Today" don't leak English into es.
          const wk = weekdayKey(r.day);
          const day = wk ? t(wk) : r.day;
          // The cover-vs-clear verdict lives in TEXT (not color alone) — WCAG 1.4.1.
          return (
            <li key={`${r.forecastOrder}-${r.day}`}>
              <Badge tone={r.coverRisk ? "cherry" : "sky"} dot={r.coverRisk}>
                {r.coverRisk ? (
                  <CloudRain aria-hidden className="h-3 w-3" />
                ) : (
                  <Sun aria-hidden className="h-3 w-3" />
                )}
                {r.coverRisk
                  ? t("stationDossier.coverRiskDay", { day, pct: r.rainPct })
                  : t("stationDossier.clearDay", { day, pct: r.rainPct })}
              </Badge>
            </li>
          );
        })}
      </ul>
    </DossierSection>
  );
}
