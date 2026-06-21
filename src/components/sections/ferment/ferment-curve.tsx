import { Activity } from "lucide-react";

import type { FermentCurvePoint, FermentReadingKind } from "@/lib/db/ferment";
import { cn } from "@/lib/utils";

/**
 * FermentCurve — the live pH/temp/Brix curve for one batch (P2-S3). A pure-
 * presentation SERVER SVG (the Phase-1 TrendLine zero-JS idiom): it plots the reading
 * series in a fixed viewBox stretched to the container, draws the recipe's target band
 * as a glass overlay, and marks the cut threshold. Text never lives inside the stretched
 * SVG — axis labels are an HTML row below. No client JS.
 *
 * The y-axis spans a kind-appropriate band (pH 3–7, temp 10–35°C, Brix 0–25) padded to
 * the data so the curve never clips and the target band sits where the eye expects it.
 */

const VB_W = 600;
const VB_H = 200;
const PAD_Y = 10;

const KIND_LABEL: Record<FermentReadingKind, string> = {
  ph: "pH",
  temp: "Temp °C",
  brix: "Brix °Bx",
};

const KIND_COLOR: Record<FermentReadingKind, string> = {
  ph: "#1A6B4D", // forest
  temp: "#B45309", // honey-700
  brix: "#0369A1", // sky
};

/** A sane default display band per reading kind (min, max), widened to the data. */
const KIND_BAND: Record<FermentReadingKind, [number, number]> = {
  ph: [3, 7],
  temp: [10, 35],
  brix: [0, 25],
};

export function FermentCurve({
  points,
  targetPh,
  kind,
}: {
  points: FermentCurvePoint[];
  targetPh: number | null;
  kind: FermentReadingKind;
}) {
  const series = points.filter((p) => p.readingKind === kind);
  const color = KIND_COLOR[kind];
  const label = KIND_LABEL[kind];

  if (series.length === 0) {
    return (
      <div
        data-testid="ferment-curve-empty"
        className="flex h-[200px] flex-col items-center justify-center rounded-2xl border border-white/60 bg-white/45 text-center"
      >
        <Activity className="h-6 w-6 text-muted-fg/60" aria-hidden />
        <p className="mt-2 text-sm text-muted-fg">No {label} readings yet</p>
        <p className="mt-0.5 text-xs text-muted-fg/70">
          Log a reading to start the live curve.
        </p>
      </div>
    );
  }

  // y-domain: the kind band, widened to include the data + (for pH) the target.
  const values = series.map((s) => s.value);
  const candidates = [...values, ...KIND_BAND[kind]];
  if (kind === "ph" && targetPh !== null) candidates.push(targetPh);
  const yMin = Math.min(...candidates);
  const yMax = Math.max(...candidates);
  const ySpan = yMax - yMin || 1;

  // x-domain: hours elapsed (0 → max), so the curve reads left-to-right in time.
  const hours = series.map((s) => s.hoursElapsed);
  const xMax = Math.max(...hours, 1);

  const plotTop = PAD_Y;
  const plotBottom = VB_H - PAD_Y;
  const plotH = plotBottom - plotTop;

  const xAt = (h: number) => (xMax <= 0 ? VB_W / 2 : (h / xMax) * VB_W);
  const yAt = (v: number) => plotBottom - ((v - yMin) / ySpan) * plotH;

  const coords = series
    .slice()
    .sort((a, b) => a.hoursElapsed - b.hoursElapsed)
    .map((s) => ({ x: xAt(s.hoursElapsed), y: yAt(s.value) }));

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");

  // The recipe target band (pH only in v1): a thin glass strip at the target line.
  const showBand = kind === "ph" && targetPh !== null;
  const bandY = showBand ? yAt(targetPh!) : 0;

  const gradId = `ferment-grad-${kind}`;
  const ariaSummary = `${label} ferment curve, ${series.length} readings over ${xMax.toFixed(0)} hours, from ${Math.min(...values)} to ${Math.max(...values)}.`;

  return (
    <div className="w-full">
      <div className="relative" style={{ height: VB_H }}>
        <svg
          role="img"
          aria-label={ariaSummary}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          width="100%"
          height={VB_H}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* faint gridlines */}
          {[0, 0.5, 1].map((g) => (
            <line
              key={g}
              x1={0}
              y1={plotTop + g * plotH}
              x2={VB_W}
              y2={plotTop + g * plotH}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="text-line"
              opacity={0.5}
            />
          ))}

          {/* recipe target band — the glass overlay the curve is cut against */}
          {showBand && (
            <g data-testid="ferment-target-band">
              <rect
                x={0}
                y={Math.max(plotTop, bandY - 6)}
                width={VB_W}
                height={12}
                fill={color}
                opacity={0.12}
              />
              <line
                x1={0}
                y1={bandY}
                x2={VB_W}
                y2={bandY}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="6 5"
                vectorEffect="non-scaling-stroke"
                opacity={0.85}
              />
            </g>
          )}

          {/* area fill */}
          {coords.length > 0 && (
            <path
              d={`${linePath} L${coords[coords.length - 1].x.toFixed(2)} ${plotBottom} L${coords[0].x.toFixed(2)} ${plotBottom} Z`}
              fill={`url(#${gradId})`}
              stroke="none"
            />
          )}

          {/* the curve */}
          <path
            data-testid="ferment-curve-line"
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* target readout overlay (HTML so it stays crisp under the stretch) */}
        {showBand && (
          <span
            className={cn(
              "pointer-events-none absolute right-2 -translate-y-1/2 rounded-md px-2 py-0.5 text-[10px] font-medium",
              "bg-white/80 text-ink shadow-sm",
            )}
            style={{ top: `${((bandY / VB_H) * 100).toFixed(2)}%` }}
          >
            target {targetPh}
          </span>
        )}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-muted-fg">
        <span>0h</span>
        <span>{Math.round(xMax / 2)}h</span>
        <span>{Math.round(xMax)}h</span>
      </div>
    </div>
  );
}
