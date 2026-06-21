import { cn } from "@/lib/utils";

export interface BarMiniDatum {
  /** Short label shown beneath the bar. */
  label: string;
  /** Numeric value the bar height is proportional to. */
  value: number;
}

export interface BarMiniProps {
  /** Series to plot. Empty arrays render nothing meaningful. */
  data: BarMiniDatum[];
  /** Bar fill color. Defaults to a forest green. */
  color?: string;
  /** Plot area height in pixels. Defaults to 140. */
  height?: number;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Mini bar chart built from HTML/CSS (not SVG) for crisp, responsive bars.
 * Each bar is a vertical gradient (lighter at the top, deepening to the base
 * color) with a softly rounded crown, a subtle drop shadow, and a specular
 * gloss that brightens on hover — pure transform/opacity, so it stays 60fps.
 * The trailing (most recent) bar is rendered at full strength to draw the eye;
 * earlier bars are dimmed. Heights are scaled to the maximum value in the set.
 */
export function BarMini({
  data,
  color = "#1A6B4D",
  height = 140,
  className,
}: BarMiniProps) {
  const max = data.reduce((acc, d) => Math.max(acc, d.value), 0);
  const lastIndex = data.length - 1;

  const ariaLabel =
    data.length > 0
      ? `Bar chart of ${data.length} values, from ${data[0].label} (${data[0].value}) to ${data[lastIndex].label} (${data[lastIndex].value}).`
      : "Bar chart with no data.";

  // Explicit empty state — a labelled, accessible placeholder rather than a
  // silently-empty plot, so a card with no harvest reads as "nothing yet" and
  // not as a broken chart.
  if (data.length === 0) {
    return (
      <div
        className={cn("flex flex-col", className)}
        role="img"
        aria-label={ariaLabel}
      >
        <div
          className="flex items-center justify-center rounded-lg text-sm text-muted-fg"
          style={{ height: `${height}px` }}
        >
          No harvest data yet.
        </div>
      </div>
    );
  }

  // Vertical gradient: a lighter tint of the bar color up top, deepening to
  // the base color at the foot. color-mix keeps this correct for any hex the
  // caller passes (forest, coffee, honey…) without hardcoding a second color.
  const barGradient = `linear-gradient(to top, ${color} 0%, color-mix(in srgb, ${color} 82%, white) 62%, color-mix(in srgb, ${color} 64%, white) 100%)`;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="flex items-end gap-1.5"
        style={{ height: `${height}px` }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          // Guard the scale: a non-positive max (empty/all-zero/non-finite set)
          // collapses every bar to a clean 0% — never NaN/Infinity from a
          // divide-by-zero. `Number.isFinite` also tolerates a stray NaN datum.
          const heightPct =
            max > 0 && Number.isFinite(d.value)
              ? Math.max(0, (d.value / max) * 100)
              : 0;
          const isLast = i === lastIndex;
          return (
            // `h-full` makes this flex item stretch to the plot's definite
            // pixel height. Without it, `align-items:flex-end` leaves the item
            // content-sized (indefinite), so the bar's percentage height below
            // resolves to `auto` → 0 and every bar renders invisible — the
            // /harvests "blank chart" regression.
            <div key={`${d.label}-${i}`} className="flex h-full flex-1 items-end">
              <div
                data-bar
                data-testid="bar-mini-bar"
                title={`${d.label}: ${d.value}`}
                className={cn(
                  "group/bar relative w-full origin-bottom rounded-t-lg",
                  "shadow-[0_2px_6px_-1px_rgba(9,59,42,0.28)] ring-1 ring-inset ring-white/25",
                  "transition-[transform,box-shadow] duration-500 ease-out",
                  "will-change-transform hover:-translate-y-0.5",
                  "hover:shadow-[0_8px_18px_-4px_rgba(9,59,42,0.4)]",
                )}
                style={{
                  height: `${heightPct}%`,
                  backgroundImage: barGradient,
                  opacity: isLast ? 1 : 0.58,
                }}
              >
                {/* Top specular cap — a soft sheen that brightens on hover. */}
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-lg",
                    "bg-gradient-to-b from-white/40 to-transparent",
                    "opacity-70 transition-opacity duration-300 group-hover/bar:opacity-100",
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <div
            key={`${d.label}-label-${i}`}
            className="flex-1 truncate text-center text-[10px] text-muted-fg"
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
