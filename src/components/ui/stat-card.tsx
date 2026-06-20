import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "forest" | "honey" | "cherry" | "coffee" | "sky";
type DeltaDir = "up" | "down" | "flat";

export interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  delta?: { value: string; dir: DeltaDir };
  hint?: string;
  accent?: Accent;
  spark?: number[];
}

/** Icon-chip background + text color, by accent. Full literal classes (no interpolation). */
const ICON_CHIP: Record<Accent, string> = {
  forest: "bg-forest-100 text-forest",
  honey: "bg-honey-100 text-honey",
  cherry: "bg-cherry-100 text-cherry",
  coffee: "bg-coffee-200 text-coffee",
  sky: "bg-sky-100 text-sky",
};

/** Sparkline text color, by accent (drives currentColor in the SVG). */
const SPARK_COLOR: Record<Accent, string> = {
  forest: "text-forest-500",
  honey: "text-honey",
  cherry: "text-cherry",
  coffee: "text-coffee-400",
  sky: "text-sky",
};

const DELTA_META: Record<
  DeltaDir,
  { color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  up: { color: "text-forest-600", Icon: ArrowUpRight },
  down: { color: "text-cherry", Icon: ArrowDownRight },
  flat: { color: "text-muted-fg", Icon: Minus },
};

/**
 * StatCard — a single KPI surface.
 * Label + optional icon chip, big display value, optional delta row, and an
 * optional self-contained inline area sparkline tinted by the chosen accent.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  hint,
  accent = "forest",
  spark,
}: StatCardProps) {
  const deltaMeta = delta ? DELTA_META[delta.dir] : null;

  return (
    <Card className="glass-hover animate-rise p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {label}
        </span>
        {Icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
              ICON_CHIP[accent]
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>

      <div className="mt-3 font-display text-3xl font-bold text-ink">
        {value}
      </div>

      {delta || hint ? (
        <div className="mt-2 flex items-center gap-1.5 text-sm">
          {delta && deltaMeta ? (
            <span
              className={cn("flex items-center gap-0.5 font-semibold", deltaMeta.color)}
            >
              <deltaMeta.Icon className="h-4 w-4" />
              {delta.value}
            </span>
          ) : null}
          {hint ? <span className="text-muted-fg">{hint}</span> : null}
        </div>
      ) : null}

      {spark && spark.length > 1 ? (
        <Sparkline values={spark} className={cn("mt-3", SPARK_COLOR[accent])} />
      ) : null}
    </Card>
  );
}

/** Self-contained inline area sparkline. Uses currentColor for both line and fill. */
function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const WIDTH = values.length - 1; // viewBox x-units: one per gap between points
  const HEIGHT = 36;
  const PAD = 3; // vertical breathing room so peaks/troughs aren't clipped

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((v, i) => {
    const x = i;
    const y = PAD + (1 - (v - min) / span) * (HEIGHT - PAD * 2);
    return { x, y };
  });

  const line = points.map((p) => `${p.x},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} ${WIDTH},${HEIGHT} 0,${HEIGHT}`;
  const fillId = `spark-fade-${values.length}-${Math.round(max)}-${Math.round(min)}`;

  return (
    <svg
      role="img"
      aria-label="Trend sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height={HEIGHT}
      className={cn("block", className)}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${fillId})`} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
