import { FlaskConical, Sun, Droplets, PackageCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { getBatches } from "@/lib/db/processing";
import { kg, num, pct } from "@/lib/utils";

/**
 * ProcessingSummary — a divided strip of headline numbers for the wet mill →
 * drying → green pipeline. Derived live from `batches` so it always reflects
 * whatever is currently moving through the mill.
 */
export async function ProcessingSummary() {
  const t = await getTranslations("processing");
  const batches = await getBatches();

  const dryingBatches = batches.filter((b) => b.stage === "drying");

  // Active = anything still in the pipeline (not yet finished as green coffee).
  const activeCount = batches.filter((b) => b.stage !== "green").length;

  // Total weight currently resting on the raised drying beds.
  const onDryingKg = dryingBatches.reduce((sum, b) => sum + b.currentKg, 0);

  // Average moisture across the drying beds (guard against an empty bed list).
  const avgMoisture =
    dryingBatches.length > 0
      ? dryingBatches.reduce((sum, b) => sum + b.moisturePct, 0) /
        dryingBatches.length
      : 0;

  // Finished green coffee, ready for milling/export.
  const greenReadyKg = batches
    .filter((b) => b.stage === "green")
    .reduce((sum, b) => sum + b.currentKg, 0);

  return (
    <Card className="animate-rise overflow-hidden">
      <CardContent className="p-0">
        <div className="stagger grid grid-cols-2 divide-y divide-white/50 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <Tile
            label={t("summary.activeBatches")}
            value={num(activeCount)}
            sub={t("summary.activeBatchesSub")}
            accent="forest"
            icon={FlaskConical}
            className="glass-hover border-r border-white/50 lg:border-r-0"
          />
          <Tile
            label={t("summary.onDryingBeds")}
            value={kg(onDryingKg)}
            sub={
              dryingBatches.length === 1
                ? t("summary.bedsResting", { n: num(dryingBatches.length) })
                : t("summary.bedsRestingPlural", {
                    n: num(dryingBatches.length),
                  })
            }
            accent="honey"
            icon={Sun}
            className="glass-hover"
          />
          <Tile
            label={t("summary.avgMoisture")}
            value={pct(avgMoisture)}
            sub={t("summary.avgMoistureSub")}
            accent="sky"
            icon={Droplets}
            className="glass-hover border-r border-white/50 lg:border-r-0"
          />
          <Tile
            label={t("summary.greenReady")}
            value={kg(greenReadyKg)}
            sub={t("summary.greenReadySub")}
            accent="coffee"
            icon={PackageCheck}
            className="glass-hover"
          />
        </div>
      </CardContent>
    </Card>
  );
}
