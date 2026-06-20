import { Mountain, Sprout, TreePine, TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { plots } from "@/lib/data/plots";
import { num } from "@/lib/utils";

/**
 * PlotsSummary — a single divided strip of headline metrics computed from the
 * farm's growing lots. Borderless Tiles sit inside one Card grid.
 */
export function PlotsSummary() {
  const totalAreaHa = plots.reduce((sum, plot) => sum + plot.areaHa, 0);
  const totalTrees = plots.reduce((sum, plot) => sum + plot.trees, 0);
  const avgAltitude =
    plots.length === 0
      ? 0
      : plots.reduce((sum, plot) => sum + plot.altitudeMasl, 0) / plots.length;
  const needsAttention = plots.filter((plot) => plot.status !== "healthy").length;

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-line md:grid-cols-4">
        <Tile
          label="Total area"
          value={num(totalAreaHa, 1)}
          sub="hectares"
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label="Total trees"
          value={num(totalTrees)}
          sub="coffee trees"
          accent="coffee"
          icon={TreePine}
        />
        <Tile
          label="Avg altitude"
          value={num(Math.round(avgAltitude))}
          sub="masl"
          accent="sky"
          icon={Mountain}
        />
        <Tile
          label="Need attention"
          value={num(needsAttention)}
          sub={`of ${num(plots.length)} plots`}
          accent="cherry"
          icon={TriangleAlert}
        />
      </div>
    </Card>
  );
}
