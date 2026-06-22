import { CloudOff, Radar, Satellite } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { MapCanvas } from "@/components/islands/MapCanvas.client";
import { getPlotsGeoJSON, getReserveGeoJSON } from "@/lib/db/geo";
import { getPlotPhiStatus, getPlotVegetation } from "@/lib/db/remote-sensing";
import { PALETTE } from "@/lib/brand";
import { num } from "@/lib/utils";

import { PhiChips } from "@/components/sections/ipm/phi-chips";
import { VegetationGrid } from "./vegetation-grid";

/**
 * SatelliteBoard — the /satellite surface (P2-S12, "the map layer").
 *
 * Async Server Component: the headline view is the farm map itself — the same
 * reusable MapLibre island /map mounts — so vegetation health reads spatially,
 * plot by plot, the way the slice is named for. A prominent, honest CONFIDENCE
 * legend floats over the canvas (high optical / SAR-carried / honestly unknown),
 * keeping the Volcán cloud a first-class number, never an invisible gap. The
 * active PHI/REI countdown chips ride here too — a pick is blocked inside an open
 * window everywhere, so safety is visible on the map surface, not only on /scouting.
 *
 * Below the map, the count-tile strip + per-plot VegetationGrid remain as the
 * always-rendered, no-JS summary/list fallback (the map island is client-only).
 *
 * World-class: glass map chrome on opaque inner chips (AD-3), responsive, AA
 * contrast, reduced-motion safe.
 */

/** The honest confidence key shown over the map — mirrors the headline strip. */
const CONFIDENCE_LEGEND: { label: string; sub: string; color: string }[] = [
  { label: "Seen clearly", sub: "high-confidence optical", color: PALETTE.forest500 },
  { label: "Radar-carried", sub: "SAR fallback under cloud", color: PALETTE.honey },
  { label: "Honestly unknown", sub: "no clear signal", color: PALETTE.coffee },
];

export async function SatelliteBoard() {
  const [rows, phi, plots, reserve] = await Promise.all([
    getPlotVegetation(),
    getPlotPhiStatus(),
    getPlotsGeoJSON(),
    getReserveGeoJSON(),
  ]);

  const high = rows.filter((r) => r.confidence === "high").length;
  const medium = rows.filter((r) => r.confidence === "medium").length;
  const low = rows.filter((r) => r.confidence === "low").length;

  return (
    <div className="space-y-6">
      {/* The headline view — the farm map tinted plot-by-plot, with the honest
          confidence key floating over it (AD-3: opaque inner chip). */}
      <section aria-label="Farm map — vegetation health">
        <div className="animate-rise relative h-[clamp(20rem,52vh,34rem)] w-full overflow-hidden rounded-2xl">
          <MapCanvas plots={plots} reserve={reserve} />

          {/* Confidence legend/badge — prominent, on-brand, opaque inner chips. */}
          <div
            data-testid="sat-confidence-legend"
            className="glass pointer-events-none absolute left-4 top-4 z-10 max-w-xs rounded-2xl p-3"
          >
            <div className="rounded-xl bg-card/95 px-3.5 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-forest-500">
                NDVI / SAR confidence
              </p>
              <ul className="mt-2 space-y-1.5">
                {CONFIDENCE_LEGEND.map(({ label, sub, color }) => (
                  <li key={label} className="flex items-start gap-2 text-xs text-ink">
                    <span
                      aria-hidden
                      className="mt-0.5 h-3 w-3 shrink-0 rounded-[4px]"
                      style={{ background: color }}
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-[10px] leading-tight text-muted-fg">
                        {sub}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* PHI/REI countdown chips — the safety windows, visible on the map surface
          too (not only on /scouting), per the P2-S12 "on every plot" wording. */}
      <section aria-label="PHI / REI safety windows">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
          Active safety windows (PHI / REI)
        </h2>
        <PhiChips rows={phi} />
      </section>

      {/* Honest confidence summary — how many plots we can see clearly vs not. */}
      <Card className="animate-rise overflow-hidden">
        <CardContent className="p-0">
          <div className="stagger grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div data-testid="sat-high-count">
              <Tile
                label="Seen clearly"
                value={num(high)}
                sub="high-confidence optical"
                accent="forest"
                icon={Satellite}
                className="glass-hover"
              />
            </div>
            <Tile
              label="Radar-carried"
              value={num(medium)}
              sub="SAR fallback under cloud"
              accent="honey"
              icon={Radar}
              className="glass-hover"
            />
            <Tile
              label="Honestly unknown"
              value={num(low)}
              sub="no clear signal — flagged, not hidden"
              accent="ink"
              icon={CloudOff}
              className="glass-hover"
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-plot list — the no-JS summary/fallback beneath the spatial map. */}
      <section aria-label="Per-plot vegetation health">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
          Plot vegetation health — NDVI / NDRE fused with SAR
        </h2>
        <VegetationGrid rows={rows} />
      </section>
    </div>
  );
}
