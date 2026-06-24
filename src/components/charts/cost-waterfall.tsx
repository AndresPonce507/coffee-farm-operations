import { useTranslations } from "next-intl";

import { cn, usd } from "@/lib/utils";

export interface CostWaterfallStep {
  /** Cost-driver label (Labor, Processing, Agronomy, Overhead…). */
  label: string;
  /** This driver's per-kg-green cost contribution (added to the running total). */
  value: number;
  /** Segment fill color — a brand token hex the caller chooses per driver. */
  color: string;
}

export interface CostWaterfallProps {
  /** The ordered cost drivers that build up to cost-per-kg-green. */
  steps: CostWaterfallStep[];
  /** Unit shown beside the running total. Defaults to "$/kg". */
  unit?: string;
  /** Plot height in pixels. Defaults to 200. */
  height?: number;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Deterministic, collision-safe id suffix (FNV-1a) so multiple waterfalls on
 * one page never share <defs> ids. Pure function of the inputs — no hooks, so
 * this stays a zero-JS Server Component, exactly like the Donut.
 */
function waterfallUid(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * S7 per-lot cost waterfall — the running build-up from the first cost driver
 * up to true cost-per-kg-green, the number the business turns on.
 *
 * Each step is a floating bar that begins where the previous one ended (a
 * classic waterfall), and a final solid "total" column lands the cumulative
 * cost-per-kg. Pure presentation: props-driven, no data deps, no hooks/events.
 *
 * Material (AD-5, inherited from `Donut`): the empty plot reads as a recessed
 * groove (a top-to-bottom track gradient + a soft inner shadow), and every
 * floating bar wears a specular gloss so it catches light like wet glass. All
 * effects are SVG <defs> keyed on a content-hashed UID — no backdrop-blur, no
 * new deps, GPU-friendly. AD-3: numeric readouts ride opaque inner chips.
 */
export function CostWaterfall({
  steps,
  unit = "$/kg",
  height = 200,
  className,
}: CostWaterfallProps) {
  const t = useTranslations("ui");
  // Running cumulative total at each step boundary. SIGNED accumulation so the
  // total equals Σ(step values) and therefore agrees with both the per-step
  // readout chips and the authoritative cost-per-kg-green headline. (Clamping to
  // ≥0 here silently dropped a net-negative category — an over-reversed driver —
  // from the total while the chip still printed it, so the build-up overstated
  // and contradicted itself; D-COST review.) Bar HEIGHT is still clamped ≥0
  // below, so a downward step degrades to a zero-height bar — no negative SVG
  // geometry — while the numbers stay correct.
  let running = 0;
  const built = steps.map((s) => {
    const start = running;
    running += s.value;
    return { ...s, start, end: running };
  });
  const total = running;

  // The vertical scale spans the cost magnitude; an empty/zero/negative set
  // degrades to a flat groove (no divide-by-zero, no NaN heights).
  const peak = total > 0 ? total : 1;

  const uid = waterfallUid(
    `${height}:${unit}:${built.map((b) => `${b.label}|${b.color}|${b.value}`).join(",")}`,
  );
  const trackId = `waterfall-track-${uid}`;
  const innerShadowId = `waterfall-inner-${uid}`;
  const glossId = `waterfall-gloss-${uid}`;
  const glowId = `waterfall-glow-${uid}`;

  // Layout: N step columns + 1 total column, evenly spaced.
  const cols = built.length + 1;
  const viewW = 320;
  const gap = 12;
  const colW = cols > 0 ? (viewW - gap * (cols + 1)) / cols : 0;

  const yFor = (v: number) => height - (v / peak) * height;

  const ariaLabel =
    built.length > 0
      ? `${t("costWaterfall.ariaPrefix")} ${built
          .map((b) =>
            t("costWaterfall.ariaStep", { label: b.label, value: usd(b.value, 2) }),
          )
          .join(", ")}. ${t("costWaterfall.ariaTotal", { total: usd(total, 2) })}`
      : t("costWaterfall.noDataAria");

  return (
    <div className={cn("inline-flex flex-col", className)}>
      <svg
        width="100%"
        viewBox={`0 0 ${viewW} ${height}`}
        height={height}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Recessed track: a soft top-to-bottom gradient so the empty plot
              reads as carved into the glass rather than a flat panel. */}
          <linearGradient id={trackId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2D8C8" />
            <stop offset="55%" stopColor="#ECE3D5" />
            <stop offset="100%" stopColor="#F4ECE0" />
          </linearGradient>

          {/* Soft inner shadow for the track — gives the groove real depth. */}
          <filter id={innerShadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feComponentTransfer in="SourceAlpha">
              <feFuncA type="table" tableValues="1 0" />
            </feComponentTransfer>
            <feGaussianBlur stdDeviation="3" />
            <feOffset dx="0" dy="1.5" result="shadow" />
            <feFlood floodColor="#7c6f5c" floodOpacity="0.35" />
            <feComposite in2="shadow" operator="in" />
            <feComposite in2="SourceGraphic" operator="over" />
          </filter>

          {/* Faint outer glow under the floating bars — lifts them off the
              living background without any blur on the content card itself. */}
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="3"
              floodColor="#1b1712"
              floodOpacity="0.18"
            />
          </filter>

          {/* Specular gloss: a top-light highlight fading to nothing, swept
              over each bar so it catches light like wet glass. */}
          <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessed groove behind the bars — the carved plot floor. */}
        <rect
          x="0"
          y="0"
          width={viewW}
          height={height}
          rx="10"
          fill={`url(#${trackId})`}
          filter={`url(#${innerShadowId})`}
        />

        {/* Floating step bars + the solid total column. */}
        {built.map((b, i) => {
          const x = gap + i * (colW + gap);
          const barTop = yFor(b.end);
          const barH = Math.max((b.value / peak) * height, 0);
          return (
            <g key={`${b.label}-${i}`} data-testid={`waterfall-step-${b.label.toLowerCase()}`}>
              <rect
                x={x}
                y={barTop}
                width={colW}
                height={barH}
                rx="4"
                fill={b.color}
                filter={`url(#${glowId})`}
              />
              {/* Specular gloss riding the top of the bar. */}
              <rect
                x={x}
                y={barTop}
                width={colW}
                height={barH}
                rx="4"
                fill={`url(#${glossId})`}
                className="pointer-events-none"
              />
            </g>
          );
        })}

        {/* The solid cumulative total column. */}
        <g data-testid="waterfall-step-total">
          <rect
            x={gap + built.length * (colW + gap)}
            y={yFor(total)}
            width={colW}
            height={Math.max((total / peak) * height, 0)}
            rx="4"
            fill="#093b2a"
            filter={`url(#${glowId})`}
          />
          <rect
            x={gap + built.length * (colW + gap)}
            y={yFor(total)}
            width={colW}
            height={Math.max((total / peak) * height, 0)}
            rx="4"
            fill={`url(#${glossId})`}
            className="pointer-events-none"
          />
        </g>
      </svg>

      {/* Readouts — each rides an opaque inner chip (AD-3, AA-on-glass). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {built.map((b, i) => (
          <span
            key={`${b.label}-readout-${i}`}
            data-testid={`waterfall-readout-${b.label.toLowerCase()}`}
            className="rounded-md bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink shadow-sm ring-1 ring-black/5"
          >
            <span
              aria-hidden
              className="mr-1 inline-block size-2 rounded-full align-middle"
              style={{ backgroundColor: b.color }}
            />
            {b.label} {usd(b.value, 2)}
          </span>
        ))}
        <span
          data-testid="waterfall-readout-total"
          className="ml-auto rounded-md bg-forest px-2 py-0.5 text-xs font-bold text-white shadow-sm"
        >
          {usd(total, 2)} {unit}
        </span>
      </div>

      {/* Visually-hidden data table — SR-legible provenance of every step. */}
      <table className="sr-only">
        <caption>{t("costWaterfall.tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("costWaterfall.tableDriver")}</th>
            <th scope="col">{t("costWaterfall.tableCost", { unit })}</th>
            <th scope="col">{t("costWaterfall.tableRunningTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {built.map((b, i) => (
            <tr key={`${b.label}-row-${i}`}>
              <td>{b.label}</td>
              <td>{usd(b.value, 2)}</td>
              <td>{usd(b.end, 2)}</td>
            </tr>
          ))}
          <tr>
            <td>{t("costWaterfall.tableTotal")}</td>
            <td>{usd(total, 2)}</td>
            <td>{usd(total, 2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
