import { Beaker, Clock } from "lucide-react";

import type {
  FermentBatch,
  FermentCurvePoint,
  FermentCutpoint,
  FermentReadingKind,
  WaterPerKg,
} from "@/lib/db/ferment";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { longDate } from "@/lib/utils";

import { CutpointAlert } from "./cutpoint-alert";
import { FermentCurve } from "./ferment-curve";
import { LogReadingForm } from "./log-reading-form";
import { WaterChip } from "./water-chip";

/**
 * The latest reading for a kind, formatted with its unit so a sighted user can read the
 * scale of the curve at a glance — the curves themselves are unitless squiggles. We sort
 * by hoursElapsed (the same x-domain the curve plots on) so "latest" is the rightmost
 * point, not whatever happened to come last in the array.
 */
function latestReadout(
  curve: FermentCurvePoint[],
  kind: FermentReadingKind,
): string | null {
  const series = curve
    .filter((p) => p.readingKind === kind)
    .sort((a, b) => a.hoursElapsed - b.hoursElapsed);
  if (series.length === 0) return null;
  const v = series[series.length - 1].value;
  switch (kind) {
    case "ph":
      return `pH ${v.toFixed(1)}`;
    case "temp":
      return `${v.toFixed(1)} °C`;
    case "brix":
      return `${v.toFixed(1)} °Bx`;
  }
}

/** A glass chip echoing the latest reading value beside a curve's title. */
function LatestChip({
  kind,
  value,
}: {
  kind: FermentReadingKind;
  value: string;
}) {
  return (
    <span
      data-testid={`ferment-latest-${kind}`}
      className="rounded-md bg-white/70 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums text-ink shadow-sm"
    >
      {value}
    </span>
  );
}

/**
 * FermentTracker — the per-batch make-quality cockpit (P2-S3). Composes the live curve
 * canvas (pH/temp/Brix, server SVG), the cut-point alert (the closed-loop "cut now"
 * signal), the eco-mill water-per-kg chip, and the one client island — the big
 * log-reading control that grows the curve. Server Component handed all its data by the
 * route; only the LogReadingForm ships client JS.
 *
 * The three curve panels are rendered server-side per reading kind so the page stays
 * mostly zero-JS; pH is the headline (it drives the cut-point) and gets the target band.
 */
export function FermentTracker({
  batch,
  curve,
  cutpoint,
  water,
}: {
  batch: FermentBatch;
  curve: FermentCurvePoint[];
  cutpoint: FermentCutpoint | null;
  water: WaterPerKg | null;
}) {
  const live = batch.endedAt === null;
  const targetPh = cutpoint?.targetPh ?? null;

  const latestPh = latestReadout(curve, "ph");
  const latestTemp = latestReadout(curve, "temp");
  const latestBrix = latestReadout(curve, "brix");

  return (
    <div className="space-y-6">
      {/* Batch header */}
      <Card className="animate-rise">
        <CardHeader>
          <div>
            <CardTitle>
              <span className="font-mono">{batch.lotCode}</span> ferment
            </CardTitle>
            <CardDescription>
              <span className="inline-flex items-center gap-1">
                <Beaker className="h-3.5 w-3.5" aria-hidden />
                {batch.method}
              </span>
              <span className="mx-2 text-muted-fg/40">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                Started {longDate(batch.startedAt)}
              </span>
            </CardDescription>
          </div>
          {live ? (
            <Badge tone="forest" dot>
              Live
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Finished
            </Badge>
          )}
        </CardHeader>
      </Card>

      {/* Cut-point signal — the closed-loop alert, above the fold */}
      {cutpoint && <CutpointAlert cutpoint={cutpoint} />}

      {/* The live curves — pH (headline, with the recipe target band), then temp + Brix */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="animate-rise xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>pH</CardTitle>
              <CardDescription>
                Live acidity vs the recipe target band — the curve the cut is made on
              </CardDescription>
            </div>
            {latestPh && <LatestChip kind="ph" value={latestPh} />}
          </CardHeader>
          <CardContent className="pt-2">
            <FermentCurve points={curve} targetPh={targetPh} kind="ph" />
          </CardContent>
        </Card>

        <Card className="animate-rise xl:col-span-2">
          <CardHeader>
            <CardTitle>Temperature</CardTitle>
            {latestTemp && <LatestChip kind="temp" value={latestTemp} />}
          </CardHeader>
          <CardContent className="pt-2">
            <FermentCurve points={curve} targetPh={null} kind="temp" />
          </CardContent>
        </Card>

        <Card className="animate-rise">
          <CardHeader>
            <CardTitle>Brix</CardTitle>
            {latestBrix && <LatestChip kind="brix" value={latestBrix} />}
          </CardHeader>
          <CardContent className="pt-2">
            <FermentCurve points={curve} targetPh={null} kind="brix" />
          </CardContent>
        </Card>
      </div>

      {/* Log a reading (client island) + the water-per-kg sustainability chip */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="animate-rise">
          <CardHeader>
            <div>
              <CardTitle>Log a reading</CardTitle>
              <CardDescription>
                Manual tap now — a BLE pH/temp probe drops in later behind the same door
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <LogReadingForm batchId={batch.id} />
          </CardContent>
        </Card>

        <div className="flex items-stretch">
          <WaterChip water={water} />
        </div>
      </div>
    </div>
  );
}
