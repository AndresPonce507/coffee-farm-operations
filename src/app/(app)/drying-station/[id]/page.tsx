import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { DryingStationCapacitySection } from "@/components/sections/drying/dossier/station-capacity-section";
import { DryingStationLotsSection } from "@/components/sections/drying/dossier/station-lots-section";
import { DryingStationWeatherSection } from "@/components/sections/drying/dossier/station-weather-section";
import {
  getDryingStationById,
  getDryingStationLots,
  getDryingStationWeatherRisk,
} from "@/lib/db/dossier/drying-station";
import { kg } from "@/lib/utils";

/** station `kind` → its existing `stations.*` translation key (for the subtitle). */
const KIND_KEY: Record<string, string> = {
  patio: "stations.kindPatio",
  "raised-bed": "stations.kindRaisedBed",
  guardiola: "stations.kindGuardiola",
  parabolic: "stations.kindParabolic",
};

/**
 * /drying-station/[id] — the DRYING STATION dossier (Phase 5 L2, the 8th connected
 * entity). Resolves the anchor station with one getter and `notFound()`s an unknown
 * id BEFORE any section fetch (P2 — no fabricated dossier), then `Promise.all`s the
 * lots-on-station + weather-risk reads (P3, no waterfall) and renders through
 * `<DossierShell>` + three sections (P4). Cross-links OUT to each resting lot's dossier
 * (P6). Ships loading.tsx + error.tsx (P7). Reached from the Drying tab's station card.
 */
export default async function DryingStationDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("drying");

  // 1. Resolve the anchor station first (the existence gate).
  const station = await getDryingStationById(id);
  if (!station) notFound();

  // 2. Fan the section reads out in parallel (cache()'d ports).
  const [lots, weatherRisk] = await Promise.all([
    getDryingStationLots(id),
    getDryingStationWeatherRisk(id),
  ]);

  const kindLabel = KIND_KEY[station.kind] ? t(KIND_KEY[station.kind]) : station.kind;

  return (
    <DossierShell
      kind="drying-station"
      title={station.name}
      eyebrow={t("stationDossier.eyebrow")}
      subtitle={t("stationDossier.subtitle", {
        kind: kindLabel,
        cap: kg(station.capacityKg),
      })}
      backHref="/drying"
      backLabel={t("stationDossier.backLabel")}
    >
      <DryingStationCapacitySection station={station} />
      <DryingStationLotsSection lots={lots} />
      <DryingStationWeatherSection risk={weatherRisk} />
    </DossierShell>
  );
}
