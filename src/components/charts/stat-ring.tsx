import { useTranslations } from "next-intl";

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
 * Stable, collision-safe slug for SVG gradient/filter ids so multiple rings can
 * coexist on one page without clobbering each other's <defs>. Pure + deterministic,
 * so this stays a zero-JS Server Component (no useId / hooks required).
 */
function ringId(color: string, size: number, value: number): string {
  const seed = `${color}-${size}-${Math.round(value)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return `ring-${(hash >>> 0).toString(36)}`;
}

/**
 * Circular SVG progress ring with a centered percentage and optional captions.
 * Pure presentation — no state or interactivity. The value arc is painted with a
 * specular gradient and a soft color-matched glow so it reads luminous against the
 * living-glass background.
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
  const t = useTranslations("ui");
  // Coerce a non-finite input (NaN/±Infinity) to 0 BEFORE clamping: Math.min/
  // Math.max pass NaN straight through (→ "NaN%") and let Infinity read as a
  // false 100%. This guard means no caller can ever paint a non-finite ring.
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(100, Math.max(0, safeValue));
  const center = size / 2;
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  const uid = ringId(color, size, clamped);
  const strokeId = `${uid}-stroke`;
  const glowId = `${uid}-glow`;
  const sheenId = `${uid}-sheen`;

  const ariaLabel = [
    label ? t("statRing.ariaLabelPrefix", { label }) : "",
    t("statRing.ariaPercent", { n: Math.round(clamped) }),
    sublabel ? t("statRing.ariaSublabel", { sublabel }) : "",
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
        <defs>
          {/* Specular gradient: the arc rises from the base color into a
              luminous, light-washed tip — derived from `color`, so any passed
              brand hue stays on-brand. */}
          <linearGradient
            id={strokeId}
            gradientUnits="userSpaceOnUse"
            x1={center}
            y1={size}
            x2={center}
            y2={0}
          >
            <stop offset="0%" stopColor={color} />
            <stop offset="55%" stopColor={color} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.62} />
          </linearGradient>

          {/* Soft color-matched glow that lets the arc bloom over the glass. */}
          <filter
            id={glowId}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation={STROKE_WIDTH * 0.42}
              floodColor={color}
              floodOpacity={0.5}
            />
          </filter>

          {/* Faint specular sweep laid over the track for a glass sheen. */}
          <linearGradient id={sheenId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
            <stop offset="45%" stopColor="#ffffff" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Background track. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={STROKE_WIDTH}
        />
        {/* Glassy sheen riding on the track. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${sheenId})`}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Value arc — gradient stroke, rounded caps, soft glow. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          filter={`url(#${glowId})`}
          className="transition-[stroke-dashoffset] duration-700 ease-out [will-change:stroke-dashoffset]"
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div className="flex flex-col items-center gap-0.5 px-2">
          <span className="font-display bg-gradient-to-b from-ink to-forest-700 bg-clip-text text-2xl font-bold text-transparent [text-shadow:0_1px_8px_rgb(255_255_255/0.6)]">
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
