import { cn } from "@/lib/utils";

export interface TrendLineProps {
  /** Ordered data points. The first point sits at the left edge, the last at the right. */
  data: { label: string; value: number }[];
  /** Line + area color (any CSS color). Defaults to a forest green. */
  color?: string;
  /** Rendered pixel height of the chart area. Defaults to 200. */
  height?: number;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/** Fixed internal coordinate space. The SVG stretches to its container width. */
const VB_WIDTH = 600;
const VB_HEIGHT = 200;
/** Horizontal gridline positions as a fraction of the plot height. */
const GRIDLINES = [0, 0.25, 0.5, 0.75, 1];
/** Inner vertical padding so the line never clips against the top/bottom edges. */
const PAD_Y = 8;

/**
 * Responsive SVG line + area chart. Pure presentation — renders the polyline and a
 * gradient-filled area inside a non-scaling-stroke SVG, with the x-axis labels drawn
 * as an HTML row below (text never lives inside the stretched SVG).
 */
export function TrendLine({
  data,
  color = "#1A6B4D",
  height = 200,
  className,
}: TrendLineProps) {
  const points = data.length;

  // Explicit empty state — a labelled placeholder instead of a chart frame with
  // only gridlines, so an empty series reads as "no data yet", not as a chart
  // that silently failed to draw its line.
  if (points === 0) {
    return (
      <div className={cn("w-full", className)}>
        <div
          className="flex items-center justify-center text-sm text-muted-fg"
          style={{ height }}
          role="img"
          aria-label="Trend line chart with no data."
        >
          No trend data yet.
        </div>
      </div>
    );
  }

  // Unique ids avoid collisions when several charts share one page.
  const safeColor = color.replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `trendline-gradient-${safeColor}`;
  const glowId = `trendline-glow-${safeColor}`;

  const values = data.map((d) => d.value);
  const max = points > 0 ? Math.max(...values) : 0;
  const min = points > 0 ? Math.min(...values) : 0;
  const span = max - min || 1;

  const plotTop = PAD_Y;
  const plotBottom = VB_HEIGHT - PAD_Y;
  const plotHeight = plotBottom - plotTop;

  const xAt = (i: number): number =>
    points <= 1 ? VB_WIDTH / 2 : (i / (points - 1)) * VB_WIDTH;

  const yAt = (value: number): number =>
    plotBottom - ((value - min) / span) * plotHeight;

  const coords = data.map((d, i) => ({ x: xAt(i), y: yAt(d.value) }));

  // The final plotted point, expressed as percentages of the box. The endpoint
  // dot is drawn as an HTML overlay (not an SVG <circle>) so it stays perfectly
  // round under the chart's non-uniform `preserveAspectRatio="none"` stretch.
  const lastPoint =
    coords.length > 0
      ? {
          left: `${((coords[coords.length - 1].x / VB_WIDTH) * 100).toFixed(3)}%`,
          top: `${((coords[coords.length - 1].y / VB_HEIGHT) * 100).toFixed(3)}%`,
        }
      : null;

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");

  // Area path: trace the line, then drop to the baseline and close.
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1].x.toFixed(2)} ${plotBottom} ` +
        `L${coords[0].x.toFixed(2)} ${plotBottom} Z`
      : "";

  // X-axis labels: first, a middle, and the last point (skip the middle when sparse).
  const axisLabels: string[] = [];
  if (points > 0) {
    axisLabels.push(data[0].label);
    if (points >= 3) axisLabels.push(data[Math.floor((points - 1) / 2)].label);
    if (points >= 2) axisLabels.push(data[points - 1].label);
  }

  const ariaSummary =
    points > 0
      ? `Trend line from ${data[0].label} to ${data[points - 1].label}, ${points} points, ranging ${min} to ${max}.`
      : "Trend line chart with no data.";

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
            {/* Richer vertical fill: a bright lip just under the line that melts
                into the baseline through a soft mid-tone, for real glassy depth. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="38%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            {/* Soft glow blooming beneath the stroke. */}
            <filter
              id={glowId}
              x="-5%"
              y="-20%"
              width="110%"
              height="140%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation={3} result="blur" />
              <feComponentTransfer in="blur" result="softGlow">
                <feFuncA type="linear" slope={0.45} />
              </feComponentTransfer>
            </filter>
          </defs>

          {/* Faint horizontal gridlines */}
          {GRIDLINES.map((g) => {
            const y = plotTop + g * plotHeight;
            return (
              <line
                key={g}
                x1={0}
                y1={y}
                x2={VB_WIDTH}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="text-line"
                opacity={0.6}
              />
            );
          })}

          {areaPath && (
            <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          )}

          {/* Glow: a blurred echo of the line, sitting beneath the crisp stroke. */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${glowId})`}
              opacity={0.7}
            />
          )}

          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Endpoint marker — an HTML overlay so it renders as a true circle
            (a soft halo + a crisp white-ringed dot) over the non-uniformly
            stretched SVG, tracking the most recent data point. */}
        {lastPoint && (
          <span
            aria-hidden
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: lastPoint.left, top: lastPoint.top }}
          >
            <span
              className="absolute left-1/2 top-1/2 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
              style={{ backgroundColor: color }}
            />
            <span
              className="relative block h-[7px] w-[7px] rounded-full ring-2 ring-white/90"
              style={{ backgroundColor: color }}
            />
          </span>
        )}
      </div>

      {axisLabels.length > 0 && (
        <div className="mt-2 flex justify-between text-[10px] text-muted-fg">
          {axisLabels.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
