import { Sun, CloudRain } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { AtpMeter } from "@/components/ui/atp-meter";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import { Badge } from "@/components/ui/badge";
import { STATION_KIND_KEY, weekdayKey } from "@/lib/drying/station-labels";
import { cn, kg } from "@/lib/utils";
import type { DryingWeatherRisk, StationOccupancy } from "@/lib/types";

/**
 * StationOccupancyBoard — every drying station as a glass card with a dual-bar
 * capacity meter (committed vs available kg), reusing the Phase-1 ATP meter idiom.
 * Open-air stations carry a weather-coupled "cover" alert when an upcoming high-
 * rain day is forecast (the closed-loop signal) — the station never lets the
 * family oversubscribe a bed (the `prevent_overcapacity` trigger is the teeth).
 *
 * Server component (no client JS): pure presentation over the derived
 * `station_occupancy` + `v_drying_weather_risk` reads.
 */
export function StationOccupancyBoard({
  stations,
  weatherRisk = [],
}: {
  stations: StationOccupancy[];
  weatherRisk?: DryingWeatherRisk[];
}) {
  const t = useTranslations("drying");
  // The nearest cover-risk day per station (if any) drives its alert chip.
  const riskByStation = new Map<string, DryingWeatherRisk>();
  for (const r of weatherRisk) {
    if (r.coverRisk && !riskByStation.has(r.stationId)) riskByStation.set(r.stationId, r);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t("stations.title")}</CardTitle>
        <Badge tone="neutral">{t("stations.count", { count: stations.length })}</Badge>
      </CardHeader>

      <div className="px-5 pb-5 pt-3">
        {stations.length === 0 ? (
          <EmptyState
            title={t("stations.emptyTitle")}
            description={t("stations.emptyDescription")}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stations.map((s) => {
              const risk = riskByStation.get(s.stationId);
              const overSubscribed = s.committedKg > s.capacityKg + 1e-6;
              const utilization =
                s.capacityKg > 0 ? Math.round((s.committedKg / s.capacityKg) * 100) : 0;
              return (
                <li
                  key={s.stationId}
                  data-testid="station-card"
                  className={cn(
                    "rounded-2xl border border-white/55 bg-white/55 p-4",
                    "shadow-[0_2px_8px_-4px_rgba(0,41,29,0.18)]",
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      {/* The station name drills to its dossier (/drying-station/[id]) —
                          the 8th connected entity (no cosmetic rows; PRINCIPLE Rule 1/3). */}
                      <EntityLink
                        kind="drying-station"
                        id={s.stationId}
                        name={s.name}
                        className="font-display text-sm font-semibold text-ink underline-offset-2 transition-colors hover:text-forest-700 hover:underline focus-visible:text-forest-700 focus-visible:underline"
                      >
                        {s.name}
                      </EntityLink>
                      <p className="text-[11px] text-muted-fg">
                        {t("stations.capacity", {
                          kind: STATION_KIND_KEY[s.kind] ? t(STATION_KIND_KEY[s.kind]) : s.kind,
                          cap: kg(s.capacityKg),
                        })}
                      </p>
                    </div>
                    {risk ? (
                      <Badge tone="cherry" dot>
                        <CloudRain aria-hidden className="h-3 w-3" />{" "}
                        {t("stations.cover", {
                          day: weekdayKey(risk.day) ? t(weekdayKey(risk.day)!) : risk.day,
                        })}
                      </Badge>
                    ) : (
                      <Badge tone="sky">
                        <Sun aria-hidden className="h-3 w-3" /> {t("stations.clear")}
                      </Badge>
                    )}
                  </div>

                  <AtpMeter committedKg={s.committedKg} availableKg={s.availableKg} />

                  <p className="mt-2 text-right text-[11px] tabular-nums text-muted-fg">
                    {overSubscribed ? (
                      <span className="font-semibold text-cherry">{t("stations.overCapacity")}</span>
                    ) : (
                      <>{t("stations.full", { pct: utilization })}</>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
