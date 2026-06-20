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

  // A unique gradient id avoids collisions when several charts share one page.
  const gradientId = `trendline-gradient-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

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
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
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

        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}

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
