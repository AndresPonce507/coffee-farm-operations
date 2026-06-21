import { CloudOff, Radar, Satellite } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getPlotVegetation } from "@/lib/db/remote-sensing";
import { num } from "@/lib/utils";

import { VegetationGrid } from "./vegetation-grid";

/**
 * SatelliteBoard — the /satellite surface (P2-S12).
 *
 * Async Server Component (no client JS): pulls every plot's fused NDVI/SAR read and
 * lays out a headline confidence strip + the vegetation grid. The headline is the
 * honesty made quantitative — how many plots we can see clearly (high), how many
 * radar carries (medium), how many we honestly cannot (low) — so the Volcán cloud
 * is a first-class number, never an invisible gap.
 *
 * World-class: glass tiles + grid, responsive, AA contrast, reduced-motion safe.
 */
export async function SatelliteBoard() {
  const rows = await getPlotVegetation();

  const high = rows.filter((r) => r.confidence === "high").length;
  const medium = rows.filter((r) => r.confidence === "medium").length;
  const low = rows.filter((r) => r.confidence === "low").length;

  return (
    <div className="space-y-6">
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

      <section aria-label="Per-plot vegetation health">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-fg">
          Plot vegetation health — NDVI / NDRE fused with SAR
        </h2>
        <VegetationGrid rows={rows} />
      </section>
    </div>
  );
}
