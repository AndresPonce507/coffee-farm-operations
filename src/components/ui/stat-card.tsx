import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "forest" | "honey" | "cherry" | "coffee" | "sky";
type DeltaDir = "up" | "down" | "flat";

/** Honest provenance for a derived figure (AD-4): real row count + recency. */
export interface StatProvenance {
  /** How many source rows the figure was derived from. */
  derivedFromCount: number;
  /**
   * A real recency stamp rendered verbatim after the count — the most-recent
   * source-row date (e.g. "2026-06-20"), NOT a synthetic clock time. Rendered
   * as-is, so it must already read honestly (a date is a date). Empty string
   * omits the stamp (e.g. no source rows yet).
   */
  asOf: string;
}

export interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  delta?: { value: string; dir: DeltaDir };
  hint?: string;
  accent?: Accent;
  spark?: number[];
  /**
   * Honest provenance (AD-4). When set, the card renders an always-visible
   * "derived from N harvests · <asOf date>" line — never hover-only (the
   * farm-office iPad has no hover). Omit for figures that aren't derived from rows.
   */
  provenance?: StatProvenance;
  /**
   * Mark a figure as modeled/estimated (e.g. YTD revenue not yet sourced from
   * real sales). Modeled figures render with lighter ink and an explicit
   * "est." prefix IN the readout itself (AD-4). Measured figures (default)
   * render at full visual weight.
   */
  modeled?: boolean;
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
  // text-honey (#c8922e) is ~2.67:1 on the card — below WCAG 1.4.11's 3:1 for
  // non-text UI. text-honey-700 (#8a5a12, ~5.5:1) is the darker text token.
  honey: "text-honey-700",
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
  provenance,
  modeled = false,
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

      {/*
        Measured (default): full-weight ink. Modeled: lighter ink + an explicit
        "est." prefix IN the readout (AD-4) — the estimate is legible without
        hover (the farm iPad has none).
      */}
      <div
        className={cn(
          "mt-3 font-display text-3xl font-bold",
          modeled ? "text-muted-fg" : "text-ink"
        )}
      >
        {modeled ? (
          <span className="mr-1 text-base font-semibold lowercase tracking-tight text-muted-fg">
            est.
          </span>
        ) : null}
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

      {provenance ? <ProvenanceLine {...provenance} /> : null}
    </Card>
  );
}

/**
 * Honest-provenance readout (AD-4): "derived from N harvests · <asOf date>".
 * Always visible (never hover-only) on an opaque inner chip so the muted text
 * keeps AA contrast over the glass surface.
 */
function ProvenanceLine({ derivedFromCount, asOf }: StatProvenance) {
  const harvests = derivedFromCount === 1 ? "harvest" : "harvests";
  return (
    <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-paper/80 px-2 py-1 text-[0.6875rem] font-medium leading-none text-muted-fg ring-1 ring-black/5">
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", "bg-forest-500")}
      />
      <span className="truncate">
        derived from {derivedFromCount.toLocaleString()} {harvests}
        {asOf ? <> · {asOf}</> : null}
      </span>
    </p>
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
