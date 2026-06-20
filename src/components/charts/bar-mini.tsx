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
 * The trailing (most recent) bar is rendered at full opacity to draw the eye;
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

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="flex items-end gap-1.5"
        style={{ height: `${height}px` }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          const heightPct = max > 0 ? (d.value / max) * 100 : 0;
          const isLast = i === lastIndex;
          return (
            <div key={`${d.label}-${i}`} className="flex flex-1 items-end">
              <div
                title={`${d.label}: ${d.value}`}
                className="w-full rounded-t-md transition-[height] duration-500"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: color,
                  opacity: isLast ? 1 : 0.55,
                }}
              />
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
