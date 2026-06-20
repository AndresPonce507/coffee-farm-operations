import { cn } from "@/lib/utils";

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export interface DonutProps {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
  className?: string;
}

/**
 * SVG donut chart. Pure server component (no hooks / no events).
 * Segments are drawn with stroke-dasharray + a rotation offset so they sit
 * end-to-end, starting at the top. The caller is responsible for any legend.
 */
export function Donut({
  data,
  size = 168,
  thickness = 22,
  centerLabel,
  centerSub,
  className,
}: DonutProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = data.reduce((sum, d) => sum + (d.value > 0 ? d.value : 0), 0);

  // Accumulated fraction (0..1) used to offset each segment so they sit
  // end-to-end. Built up as we map across the data.
  let offsetFraction = 0;

  const segments = data.map((d, i) => {
    const fraction = total > 0 ? Math.max(d.value, 0) / total : 0;
    const segmentLength = fraction * circumference;
    // strokeDashoffset shifts the dash pattern backwards along the circle,
    // placing each segment after the previous one.
    const dashOffset = -offsetFraction * circumference;
    offsetFraction += fraction;

    return (
      <circle
        key={`${d.label}-${i}`}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={d.color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
        strokeDashoffset={dashOffset}
      />
    );
  });

  const ariaLabel =
    data.length > 0
      ? `Donut chart. ${data
          .map((d) => {
            const share = total > 0 ? Math.round((Math.max(d.value, 0) / total) * 100) : 0;
            return `${d.label}: ${share}%`;
          })
          .join(", ")}.`
      : "Donut chart with no data.";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
      >
        {/* Faint track behind the segments. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#E7DED0"
          strokeWidth={thickness}
        />
        {/* Rotate the whole group -90deg so segments begin at the top. */}
        <g transform={`rotate(-90 ${center} ${center})`}>{segments}</g>
      </svg>

      {(centerLabel || centerSub) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel && (
            <span className="font-display text-xl font-bold text-ink leading-tight">
              {centerLabel}
            </span>
          )}
          {centerSub && <span className="text-xs text-muted-fg leading-tight">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}
