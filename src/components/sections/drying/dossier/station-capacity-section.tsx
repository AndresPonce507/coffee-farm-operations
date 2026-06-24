import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { AtpMeter } from "@/components/ui/atp-meter";
import { Badge } from "@/components/ui/badge";
import { kg } from "@/lib/utils";
import type { StationOccupancy } from "@/lib/types";

/** Maps a station `kind` to its existing `stations.*` translation key. */
const KIND_KEY: Record<string, string> = {
  patio: "stations.kindPatio",
  "raised-bed": "stations.kindRaisedBed",
  guardiola: "stations.kindGuardiola",
  parabolic: "stations.kindParabolic",
};

/**
 * DryingStationCapacitySection — the station dossier's load section: the dual-bar
 * committed-vs-available meter (reusing the ATP idiom from the board), the station
 * kind, and the over-capacity / utilization verdict. Server component over the
 * derived `station_occupancy` row. Wraps in `<DossierSection id="capacity">`.
 */
export function DryingStationCapacitySection({
  station,
}: {
  station: StationOccupancy;
}) {
  const t = useTranslations("drying");
  const over = station.committedKg > station.capacityKg + 1e-6;
  const utilization =
    station.capacityKg > 0
      ? Math.round((station.committedKg / station.capacityKg) * 100)
      : 0;
  const kindLabel = KIND_KEY[station.kind] ? t(KIND_KEY[station.kind]) : station.kind;

  return (
    <DossierSection id="capacity" title={t("stationDossier.capacityTitle")}>
      <div className="glass-card space-y-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone="neutral">{kindLabel}</Badge>
          {over ? (
            <span className="text-xs font-semibold text-cherry-700">
              {t("stationDossier.overCapacity")}
            </span>
          ) : (
            <span className="text-xs tabular-nums text-muted-fg">
              {t("stationDossier.utilization", { pct: utilization })}
            </span>
          )}
        </div>

        <AtpMeter committedKg={station.committedKg} availableKg={station.availableKg} />

        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-[11px] text-muted-fg">{t("stationDossier.committed")}</dt>
            <dd className="font-display text-sm font-semibold tabular-nums text-ink">
              {kg(station.committedKg)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-fg">{t("stationDossier.available")}</dt>
            <dd className="font-display text-sm font-semibold tabular-nums text-ink">
              {kg(station.availableKg)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-fg">{t("stationDossier.capacity")}</dt>
            <dd className="font-display text-sm font-semibold tabular-nums text-ink">
              {kg(station.capacityKg)}
            </dd>
          </div>
        </dl>
      </div>
    </DossierSection>
  );
}
