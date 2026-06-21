import { cn, pct, usd } from "@/lib/utils";

export interface CostSlice {
  /** Cost category (Labor, Processing, Agronomy, Overhead). */
  label: string;
  /** This category's share of total cost (any unit — only the ratio matters). */
  value: number;
  /** Segment fill color — a brand token hex chosen per category. */
  color: string;
}

export interface CostDecompositionProps {
  /** The cost categories that compose total cost-per-kg-green. */
  slices: CostSlice[];
  /** Bar height in pixels. Defaults to 28. */
  height?: number;
  /**
   * When set, readouts show the absolute dollar figure (usd) instead of the
   * share percent. The bar geometry is always share-driven either way.
   */
  asCurrency?: boolean;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Deterministic, collision-safe id suffix (FNV-1a) so multiple bars on one page
 * never share <defs> ids. Pure — no hooks, stays a zero-JS Server Component.
 */
function decompUid(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * S7 cost-decomposition bar — labor | processing | agronomy | overhead as a
 * single stacked bar built from pure CSS flex widths (each segment's
 * `flex-basis` is its share of the total). Pure presentation: props-driven, no
 * data deps, no hooks/events.
 *
 * Material (AD-5, inherited from `Donut`): an SVG overlay supplies the exact
 * same wet-glass material as every other chart — a recessed-groove track
 * (top-to-bottom gradient + inner shadow) reading as a carved channel, and a
 * specular gloss swept across the bar — both keyed on a content-hashed UID so
 * sibling bars never collide. The colored fills are HTML flex segments; the
 * groove and gloss are the SVG <defs> material laid over/under them. AD-3:
 * each readout rides an opaque inner chip.
 */
export function CostDecomposition({
  slices,
  height = 28,
  asCurrency = false,
  className,
}: CostDecompositionProps) {
  const total = slices.reduce((sum, s) => sum + (s.value > 0 ? s.value : 0), 0);

  const built = slices.map((s) => {
    const share = total > 0 ? Math.max(s.value, 0) / total : 0;
    return { ...s, share };
  });

  const uid = decompUid(
    `${height}:${built.map((b) => `${b.label}|${b.color}|${b.value}`).join(",")}`,
  );
  const trackId = `decomp-track-${uid}`;
  const innerShadowId = `decomp-inner-${uid}`;
  const glossId = `decomp-gloss-${uid}`;

  const ariaLabel =
    built.length > 0
      ? `Cost decomposition. ${built
          .map((b) => `${b.label}: ${pct(b.share * 100)}`)
          .join(", ")}.`
      : "Cost decomposition with no data.";

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="relative w-full overflow-hidden rounded-lg ring-1 ring-black/5"
        style={{ height: `${height}px` }}
        role="img"
        aria-label={ariaLabel}
      >
        {/* SVG material layer (AD-5): the recessed groove sits behind the
            colored segments; the specular gloss rides above them. Same <defs>
            material contract as the Donut, content-hashed so it never collides. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            {/* Recessed track gradient — the carved channel the fills sit in. */}
            <linearGradient id={trackId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E2D8C8" />
              <stop offset="55%" stopColor="#ECE3D5" />
              <stop offset="100%" stopColor="#F4ECE0" />
            </linearGradient>

            {/* Soft inner shadow — gives the groove real depth. */}
            <filter
              id={innerShadowId}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feComponentTransfer in="SourceAlpha">
                <feFuncA type="table" tableValues="1 0" />
              </feComponentTransfer>
              <feGaussianBlur stdDeviation="2" />
              <feOffset dx="0" dy="1" result="shadow" />
              <feFlood floodColor="#7c6f5c" floodOpacity="0.35" />
              <feComposite in2="shadow" operator="in" />
              <feComposite in2="SourceGraphic" operator="over" />
            </filter>

            {/* Specular gloss — a top-light sheen swept across the whole bar. */}
            <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Carved groove behind the fills. */}
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            fill={`url(#${trackId})`}
            filter={`url(#${innerShadowId})`}
          />
        </svg>

        {/* Colored segments — PURE CSS flex widths (flex-basis = share). */}
        <div className="relative flex size-full">
          {built.map((b, i) => (
            <div
              key={`${b.label}-seg-${i}`}
              data-testid={`decomp-segment-${b.label.toLowerCase()}`}
              className="h-full shrink-0 grow-0"
              style={{
                flexBasis: `${b.share * 100}%`,
                backgroundColor: b.color,
              }}
              title={`${b.label}: ${pct(b.share * 100)}`}
            />
          ))}
        </div>

        {/* Specular gloss laid over the fills — the wet-glass top sheen. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <rect x="0" y="0" width="100" height="100" fill={`url(#${glossId})`} />
        </svg>
      </div>

      {/* Legend readouts — each on an opaque inner chip (AD-3, AA-on-glass). */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {built.map((b, i) => (
          <span
            key={`${b.label}-readout-${i}`}
            data-testid={`decomp-readout-${b.label.toLowerCase()}`}
            className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink shadow-sm ring-1 ring-black/5"
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: b.color }}
            />
            {b.label}{" "}
            <span className="text-muted-fg">
              {asCurrency ? usd(b.value) : pct(b.share * 100)}
            </span>
          </span>
        ))}
      </div>

      {/* Visually-hidden data table — SR-legible provenance of every slice. */}
      <table className="sr-only">
        <caption>Cost decomposition by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Share</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {built.map((b, i) => (
            <tr key={`${b.label}-row-${i}`}>
              <td>{b.label}</td>
              <td>{pct(b.share * 100)}</td>
              <td>{usd(b.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
