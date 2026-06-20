import { cn } from "@/lib/utils";

export interface StatRingProps {
  /** Progress value, 0–100. Values outside the range are clamped. */
  value: number;
  /** Diameter of the ring in pixels. Defaults to 128. */
  size?: number;
  /** Small uppercase caption shown under the percentage. */
  label?: string;
  /** Secondary muted line shown beneath the label. */
  sublabel?: string;
  /** Stroke color of the value arc. Defaults to forest-500. */
  color?: string;
  /** Stroke color of the background track. Defaults to a warm cream. */
  track?: string;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

const STROKE_WIDTH = 12;

/**
 * Circular SVG progress ring with a centered percentage and optional captions.
 * Pure presentation — no state or interactivity.
 */
export function StatRing({
  value,
  size = 128,
  label,
  sublabel,
  color = "#1A6B4D",
  track = "#E7DED0",
  className,
}: StatRingProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const center = size / 2;
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  const ariaLabel = [
    label ? `${label}: ` : "",
    `${Math.round(clamped)} percent`,
    sublabel ? ` — ${sublabel}` : "",
  ].join("");

  return (
    <div
      className={cn(
        "relative inline-grid shrink-0 place-items-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={STROKE_WIDTH}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div className="flex flex-col items-center gap-0.5 px-2">
          <span className="font-display text-2xl font-bold text-ink">
            {Math.round(clamped)}
            <span aria-hidden="true">%</span>
          </span>
          {label ? (
            <span className="text-[11px] uppercase tracking-wide text-muted-fg">
              {label}
            </span>
          ) : null}
          {sublabel ? (
            <span className="text-xs text-muted-fg">{sublabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
