import { cn } from "@/lib/utils";
import type { MoistureReading } from "@/lib/types";

export interface MoistureCurveProps {
  /** The lot's readings, oldest → newest. */
  curve: MoistureReading[];
  /** Lower edge of the reposo target band (default 10.5%). */
  bandMin?: number;
  /** Upper edge of the reposo target band (default 11.5%). */
  bandMax?: number;
  /** Rendered pixel height. */
  height?: number;
  className?: string;
}

/** Fixed internal coordinate space; the SVG stretches to its container width. */
const VB_WIDTH = 600;
const VB_HEIGHT = 200;
const PAD_Y = 10;

/**
 * MoistureCurve — a server-rendered SVG of a lot's drying curve converging on the
 * reposo target band (10.5–11.5%). The honey band is drawn as a glass overlay so
 * the family SEES the lot settle into the window the reposo gate requires. Pure
 * presentation, zero JS (the Phase-1 zero-JS chart idiom): the polyline + band are
 * SVG; the x-axis labels are an HTML row below (text never lives in the stretched
 * SVG). The y-domain is fixed around the band so the band is always legible.
 */
export function MoistureCurve({
  curve,
  bandMin = 10.5,
  bandMax = 11.5,
  height = 200,
  className,
}: MoistureCurveProps) {
  const points = curve.length;
  const values = curve.map((d) => d.moisturePct);

  // A fixed, generous y-domain so the narrow target band is always visible even
  // when the lot starts very wet (cherries dry from ~55% down to ~11%).
  const dataMax = points > 0 ? Math.max(...values, bandMax) : bandMax;
  const dataMin = points > 0 ? Math.min(...values, bandMin) : bandMin;
  const domMax = Math.ceil(dataMax + 1);
  const domMin = Math.max(0, Math.floor(dataMin - 1));
  const span = domMax - domMin || 1;

  const plotTop = PAD_Y;
  const plotBottom = VB_HEIGHT - PAD_Y;
  const plotHeight = plotBottom - plotTop;

  const xAt = (i: number): number =>
    points <= 1 ? VB_WIDTH / 2 : (i / (points - 1)) * VB_WIDTH;
  const yAt = (v: number): number =>
    plotBottom - ((v - domMin) / span) * plotHeight;

  const coords = curve.map((d, i) => ({ x: xAt(i), y: yAt(d.moisturePct) }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");

  const bandTop = yAt(bandMax);
  const bandBottom = yAt(bandMin);

  const last = curve.length > 0 ? curve[curve.length - 1] : null;
  const lastInBand =
    last != null && last.moisturePct >= bandMin && last.moisturePct <= bandMax;

  const lastPoint =
    coords.length > 0
      ? {
          left: `${((coords[coords.length - 1].x / VB_WIDTH) * 100).toFixed(3)}%`,
          top: `${((coords[coords.length - 1].y / VB_HEIGHT) * 100).toFixed(3)}%`,
        }
      : null;

  const ariaSummary =
    points > 0
      ? `Drying moisture curve, ${points} readings, latest ${last?.moisturePct.toFixed(1)}%, target band ${bandMin}–${bandMax}%.`
      : "Drying moisture curve with no readings yet.";

  return (
    <div className={cn("w-full", className)}>
      <div className="relative" style={{ height }}>
        <svg
          role="img"
          aria-label={ariaSummary}
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height={height}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id="moisture-line" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a6b4d" />
              <stop offset="100%" stopColor="#093b2a" />
            </linearGradient>
          </defs>

          {/* The reposo TARGET BAND — a honey glass slab the curve must settle into. */}
          <rect
            data-testid="moisture-target-band"
            x={0}
            y={bandTop}
            width={VB_WIDTH}
            height={Math.max(2, bandBottom - bandTop)}
            fill="#c8922e"
            opacity={0.16}
          />
          <line
            x1={0}
            y1={bandTop}
            x2={VB_WIDTH}
            y2={bandTop}
            stroke="#c8922e"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />
          <line
            x1={0}
            y1={bandBottom}
            x2={VB_WIDTH}
            y2={bandBottom}
            stroke="#c8922e"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />

          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="url(#moisture-line)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Endpoint marker — HTML overlay so it stays a true circle under the
            non-uniform stretch. Green when the latest reading is in-band. */}
        {lastPoint && (
          <span
            aria-hidden
            data-testid="moisture-endpoint"
            data-in-band={lastInBand ? "true" : "false"}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: lastPoint.left, top: lastPoint.top }}
          >
            <span
              className={cn(
                "relative block h-[9px] w-[9px] rounded-full ring-2 ring-white/90",
                lastInBand ? "bg-forest-500" : "bg-cherry",
              )}
            />
          </span>
        )}

        {/* Band label chip — opaque, never sampling the aurora (AD-3). */}
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-honey-100 px-2 py-0.5 text-[10px] font-semibold text-honey-700">
          target {bandMin}–{bandMax}%
        </span>

        {points === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-full bg-muted px-3 py-1 text-xs text-muted-fg">
              No moisture readings yet
            </p>
          </div>
        )}
      </div>

      {points > 0 && (
        <div className="mt-2 flex justify-between text-[10px] text-muted-fg">
          <span>{points} readings</span>
          {last && (
            <span className="tabular-nums">latest {last.moisturePct.toFixed(1)}%</span>
          )}
        </div>
      )}
    </div>
  );
}
