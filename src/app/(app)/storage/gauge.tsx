import { cn } from "@/lib/utils";

/**
 * BandMeter — a glass-lite horizontal band gauge (P3-S20 storage).
 *
 * Pure server component (no client JS): a rounded track with the target band painted
 * as a forest segment and the latest reading marked by a needle. In band the needle is
 * forest; an excursion turns it cherry and pulses (motion-safe → static under
 * prefers-reduced-motion). A null reading renders a muted "no reading" needle-less
 * track, never a fabricated value. GPU-only: the pulse is opacity, the layout is
 * percentage offsets, so it stays at 60fps with many gauges on screen.
 *
 * Accessible: role="meter" with aria-valuemin/max/now so a screen reader hears the
 * number and its bounds; the in/out verdict is conveyed in text, not by color alone.
 */

/** Clamp x into [0, 100]. */
const clampPct = (x: number): number => Math.max(0, Math.min(100, x));

export interface BandMeterProps {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  /** aw uses an upper-bound only (floor is 0); temp/rh use both bounds. */
  upperOnly?: boolean;
  /** Format the numeric reading for display (defaults to a trimmed number). */
  format?: (v: number) => string;
  noReadingLabel: string;
}

export function BandMeter({
  label,
  unit,
  value,
  min,
  max,
  upperOnly = false,
  format = (v) => `${v}`,
  noReadingLabel,
}: BandMeterProps) {
  const lo = upperOnly ? 0 : min;
  const hi = max;

  // A domain that always shows both the band and the needle, padded for context.
  const lowEnd = Math.min(lo, value ?? lo);
  const highEnd = Math.max(hi, value ?? hi);
  const span = Math.max(highEnd - lowEnd, 1e-6);
  const pad = span * 0.18;
  const domainMin = lowEnd - pad;
  const domainMax = highEnd + pad;
  const domain = domainMax - domainMin;

  const pos = (x: number): number => clampPct(((x - domainMin) / domain) * 100);
  const bandLeft = pos(lo);
  const bandRight = pos(hi);

  const inBand =
    value == null
      ? null
      : upperOnly
        ? value <= max
        : value >= min && value <= max;

  return (
    <div
      role="meter"
      aria-label={
        value == null ? `${label}: ${noReadingLabel}` : `${label}: ${format(value)} ${unit}`
      }
      aria-valuemin={Math.round(domainMin * 100) / 100}
      aria-valuemax={Math.round(domainMax * 100) / 100}
      aria-valuenow={value ?? undefined}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
          {label}
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            value == null ? "text-muted-fg" : inBand ? "text-forest" : "text-cherry",
          )}
        >
          {value == null ? noReadingLabel : `${format(value)} ${unit}`}
        </span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-line">
        {/* Target band segment. */}
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-full bg-forest/25"
          style={{ left: `${bandLeft}%`, width: `${Math.max(bandRight - bandLeft, 1)}%` }}
        />
        {/* Needle at the latest reading. */}
        {value != null && (
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
              inBand
                ? "bg-forest"
                : "bg-cherry shadow-[0_0_0_2px_rgba(168,65,42,0.18)] motion-safe:animate-pulse",
            )}
            style={{ left: `${pos(value)}%` }}
          />
        )}
      </div>
    </div>
  );
}
