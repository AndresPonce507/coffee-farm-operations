import { FlaskConical, Sun, Droplets, PackageCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { batches } from "@/lib/data/processing";
import { kg, num, pct } from "@/lib/utils";

/**
 * ProcessingSummary — a divided strip of headline numbers for the wet mill →
 * drying → green pipeline. Derived live from `batches` so it always reflects
 * whatever is currently moving through the mill.
 */
export function ProcessingSummary() {
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
        <div className="grid grid-cols-2 divide-y divide-line lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <Tile
            label="Active batches"
            value={num(activeCount)}
            sub="in the pipeline"
            accent="forest"
            icon={FlaskConical}
            className="border-r border-line lg:border-r-0"
          />
          <Tile
            label="On drying beds"
            value={kg(onDryingKg)}
            sub={`${num(dryingBatches.length)} bed${
              dryingBatches.length === 1 ? "" : "s"
            } resting`}
            accent="honey"
            icon={Sun}
          />
          <Tile
            label="Avg moisture"
            value={pct(avgMoisture)}
            sub="across drying beds"
            accent="sky"
            icon={Droplets}
            className="border-r border-line lg:border-r-0"
          />
          <Tile
            label="Green ready"
            value={kg(greenReadyKg)}
            sub="cleared for export"
            accent="coffee"
            icon={PackageCheck}
          />
        </div>
      </CardContent>
    </Card>
  );
}
