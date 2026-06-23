import { useTranslations } from "next-intl";

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
 * Deterministic, collision-safe id suffix so multiple donuts on one page don't
 * share <defs> ids (which are global in the DOM). Pure function of the inputs —
 * no hooks, so this stays a server component.
 */
function donutUid(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * SVG donut chart. Pure server component (no hooks / no events).
 * Segments are drawn with stroke-dasharray + a rotation offset so they sit
 * end-to-end, starting at the top. The caller is responsible for any legend.
 *
 * Glass polish (visual only, no API change): the track carries a soft inner
 * shadow + recessed gradient so the ring reads as a frosted groove; the colored
 * segments wear a faint specular gloss and a low-spread outer glow that lifts
 * them off the living background. All effects are SVG <defs> — no backdrop-blur,
 * no new deps, GPU-friendly.
 */
export function Donut({
  data,
  size = 168,
  thickness = 22,
  centerLabel,
  centerSub,
  className,
}: DonutProps) {
  const t = useTranslations("ui");
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = data.reduce((sum, d) => sum + (d.value > 0 ? d.value : 0), 0);

  // Explicit empty state — when there's nothing to plot (no slices, or every
  // slice is zero) show a labelled placeholder instead of a bare track ring
  // that reads as a chart which silently failed to render.
  if (data.length === 0 || total <= 0) {
    return (
      <div
        className={cn(
          "relative inline-flex items-center justify-center rounded-full text-center text-xs text-muted-fg",
          className,
        )}
        style={{ width: size, height: size }}
        role="img"
        aria-label={t("donut.noDataAria")}
      >
        {t("donut.empty")}
      </div>
    );
  }

  // Per-instance suffix keyed on the actual content, so two charts never reuse
  // the same gradient/filter ids.
  const uid = donutUid(
    `${size}:${thickness}:${centerLabel ?? ""}:${data.map((d) => `${d.label}|${d.color}|${d.value}`).join(",")}`,
  );
  const glossId = `donut-gloss-${uid}`;
  const trackId = `donut-track-${uid}`;
  const innerShadowId = `donut-inner-${uid}`;
  const glowId = `donut-glow-${uid}`;

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
        filter={`url(#${glowId})`}
      />
    );
  });

  const ariaLabel =
    data.length > 0
      ? `${t("donut.ariaPrefix")} ${data
          .map((d) => {
            const share = total > 0 ? Math.round((Math.max(d.value, 0) / total) * 100) : 0;
            return t("donut.ariaSlice", { label: d.label, share });
          })
          .join(", ")}.`
      : t("donut.noDataAria");

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
        <defs>
          {/* Recessed track: a soft top-to-bottom gradient so the empty groove
              reads as carved into the glass rather than a flat ring. */}
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
            <feGaussianBlur stdDeviation={Math.max(thickness * 0.16, 1.5)} />
            <feOffset dx="0" dy={Math.max(thickness * 0.05, 0.75)} result="shadow" />
            <feFlood floodColor="#7c6f5c" floodOpacity="0.35" />
            <feComposite in2="shadow" operator="in" />
            <feComposite in2="SourceGraphic" operator="over" />
          </filter>

          {/* Faint outer glow under the colored segments — lifts the ring off
              the living background without any blur on the content card itself. */}
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation={Math.max(thickness * 0.18, 2)}
              floodColor="#1b1712"
              floodOpacity="0.18"
            />
          </filter>

          {/* Specular gloss: a top-left highlight fading to nothing, swept over
              the segments so the ring catches light like wet glass. */}
          <linearGradient id={glossId} x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Faint track behind the segments — recessed gradient + inner shadow. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${trackId})`}
          strokeWidth={thickness}
          filter={`url(#${innerShadowId})`}
        />
        {/* Rotate the whole group -90deg so segments begin at the top. */}
        <g transform={`rotate(-90 ${center} ${center})`}>{segments}</g>

        {/* Specular gloss riding the inner half of the ring, masked to the ring
            band so it only brightens the stroke — never the hollow center. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${glossId})`}
          strokeWidth={thickness * 0.62}
          className="pointer-events-none"
        />
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
