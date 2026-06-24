import { Mountain, Sprout, TreePine, TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getPlots } from "@/lib/db/plots";
import { num } from "@/lib/utils";

/**
 * PlotsSummary — a single divided strip of headline metrics computed from the
 * farm's growing lots. Borderless Tiles sit inside one Card grid.
 */
export async function PlotsSummary() {
  const t = await getTranslations("plots");
  const plots = await getPlots();
  const totalAreaHa = plots.reduce((sum, plot) => sum + plot.areaHa, 0);
  const totalTrees = plots.reduce((sum, plot) => sum + plot.trees, 0);
  const avgAltitude =
    plots.length === 0
      ? 0
      : plots.reduce((sum, plot) => sum + plot.altitudeMasl, 0) / plots.length;
  const needsAttention = plots.filter((plot) => plot.status !== "healthy").length;

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="stagger grid grid-cols-2 divide-x divide-y divide-white/60 md:grid-cols-4 md:divide-y-0">
        <Tile
          label={t("summary.totalArea")}
          value={num(totalAreaHa, 1)}
          sub={t("summary.totalAreaSub")}
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label={t("summary.totalTrees")}
          value={num(totalTrees)}
          sub={t("summary.totalTreesSub")}
          accent="coffee"
          icon={TreePine}
        />
        <Tile
          label={t("summary.avgAltitude")}
          value={num(Math.round(avgAltitude))}
          sub={t("summary.avgAltitudeSub")}
          accent="sky"
          icon={Mountain}
        />
        <Tile
          label={t("summary.needAttention")}
          value={num(needsAttention)}
          sub={t("summary.needAttentionSub", { n: num(plots.length) })}
          accent="cherry"
          icon={TriangleAlert}
        />
      </div>
    </Card>
  );
}
