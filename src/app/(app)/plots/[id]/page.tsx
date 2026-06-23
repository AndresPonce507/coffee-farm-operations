import { notFound } from "next/navigation";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { PlotIdentitySection } from "@/components/sections/plots/dossier/plot-identity-section";
import { PlotHarvestsSection } from "@/components/sections/plots/dossier/plot-harvests-section";
import { PlotSatelliteSection } from "@/components/sections/plots/dossier/plot-satellite-section";
import { PlotScoutingSection } from "@/components/sections/plots/dossier/plot-scouting-section";
import { PlotSpraySection } from "@/components/sections/plots/dossier/plot-spray-section";
import { PlotCostSection } from "@/components/sections/plots/dossier/plot-cost-section";
import { PlotYieldSection } from "@/components/sections/plots/dossier/plot-yield-section";
import { PlotEudrSection } from "@/components/sections/plots/dossier/plot-eudr-section";
import { getPlotById } from "@/lib/db/plots";
import { getHarvestsForPlot } from "@/lib/db/harvests";
import { getPlotCost } from "@/lib/db/cogs";
import { getPlotOriginStatus } from "@/lib/db/eudr";
import { getPlotVegetation } from "@/lib/db/remote-sensing";
import {
  getPlotPhiWindows,
  getPlotSprayHistory,
  getPlotScouting,
  getPickerIdByName,
  getPlotYield,
} from "@/lib/db/dossier/plot";

/**
 * /plots/[id] — the PLOT dossier (US-03). The connected, single-pane view of
 * one plot across every tab it touches: identity & geometry, the harvests it
 * produced (each picker → /workers/[id], each lot → /lots/[code]), its
 * satellite/NDVI read with HONEST confidence, the active scouting calls, the
 * spray log + PHI harvest-block (each applicator → /workers/[id]),
 * cost-per-kg-green (DRILLS to its source ledger), the season yield (DRILLS to
 * the harvest records), and its EUDR origin status (each green lot it feeds →
 * /lots/[code]#eudr).
 *
 * Async Server Component (facet-02 P1–P7): Next 15 `params` is a Promise; the
 * ANCHOR plot is resolved with ONE getter and `notFound()`s a ghost id BEFORE
 * any section fetch (no fabricated dossier, cheapest 404); the section reads fan
 * out in a single `Promise.all` of `cache()`'d getters (no waterfall); every
 * row is rendered through the shared <DossierShell> + <…Section> primitives, and
 * every entity name is an <EntityLink>. No `@/lib/data/*` import (mock-leak
 * guard). Skeleton via the sibling loading.tsx.
 */
export default async function PlotDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 1. ANCHOR existence gate — one cheap getter, 404 before any section fetch.
  const plot = await getPlotById(id);
  if (!plot) notFound();

  // 2. Fan the section reads out in parallel (all React-cache()'d getters).
  const [
    harvests,
    pickerIds,
    vegetation,
    phi,
    sprays,
    scouting,
    cost,
    originStatus,
  ] = await Promise.all([
    getHarvestsForPlot(id),
    getPickerIdByName(),
    getPlotVegetation(),
    getPlotPhiWindows(id),
    getPlotSprayHistory(id),
    getPlotScouting(id),
    getPlotCost(id),
    getPlotOriginStatus(id),
  ]);

  // getPlotVegetation() returns every plot's fused read; the section is a pure
  // single-plot component, so narrow it here (null → honest "no signal" empty).
  const plotVegetation = vegetation.find((v) => v.plotId === id) ?? null;
  // Pure derived rollup over the already-resolved anchor (no extra fetch).
  const yld = getPlotYield(plot);

  return (
    <DossierShell
      kind="plot"
      title={plot.name}
      eyebrow="Parcela"
      subtitle={`${plot.variety} · ${plot.areaHa} ha · ${plot.altitudeMasl} msnm`}
      backHref="/plots"
      backLabel="Todas las parcelas"
    >
      <PlotIdentitySection plot={plot} />
      <PlotYieldSection yield={yld} plotId={id} />
      <PlotHarvestsSection harvests={harvests} pickerIds={pickerIds} />
      <PlotSatelliteSection vegetation={plotVegetation} />
      <PlotSpraySection phi={phi} sprays={sprays} />
      <PlotScoutingSection scouting={scouting} />
      <PlotCostSection cost={cost} plotId={id} />
      <PlotEudrSection status={originStatus} />
    </DossierShell>
  );
}
