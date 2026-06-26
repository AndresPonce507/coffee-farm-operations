import { useTranslations } from "next-intl";

import { cn, kg } from "@/lib/utils";

export interface AtpMeterProps {
  /** Kilograms already committed (reserved + shipped) against the lot. */
  committedKg: number;
  /** Available-to-promise kilograms (current − reserved − shipped). */
  availableKg: number;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Dual-bar ATP meter — a single stacked glass track split into a *committed*
 * segment (reserved + shipped) butted against an *available-to-promise* (ATP)
 * segment. The committed slab reads in deep forest; the ATP slab in honey —
 * the at-a-glance "how much can I still sell?" signal for a green lot.
 *
 * Performance: both segments size with GPU-only `transform: scaleX()` against a
 * `transform-origin` at their own edge — no `width` reflow, no JS tween. The
 * project's global `prefers-reduced-motion` rule zeroes the transition-duration,
 * so the bar simply snaps for motion-sensitive users.
 *
 * Accessibility (AD-3): every numeric readout rides an *opaque* inner chip
 * (solid token background), never sampling the translucent track behind it, so
 * the label contrast floor holds regardless of the living-aurora backdrop.
 */
export function AtpMeter({ committedKg, availableKg, className }: AtpMeterProps) {
  const t = useTranslations("ui");
  // Defend against negative inputs (an over-sold lot should never invert the
  // bar) and a zero-total lot (no divide-by-zero → NaN in the transform).
  const committed = Math.max(0, committedKg);
  const available = Math.max(0, availableKg);
  const total = committed + available;

  const committedRatio = total > 0 ? committed / total : 0;
  const availableRatio = total > 0 ? available / total : 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* The track: a recessed glass groove that the two slabs fill. */}
      <div
        role="meter"
        aria-label={t("atpMeter.ariaLabel")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={available}
        aria-valuetext={t("atpMeter.valueText", {
          available: kg(available),
          total: kg(total),
        })}
        className={cn(
          "relative flex h-3.5 w-full overflow-hidden rounded-full",
          "border border-white/45 bg-muted",
          "shadow-[inset_0_1px_2px_rgba(27,23,18,0.10)]",
        )}
      >
        {/* Committed slab — deep forest, anchored to the left edge. */}
        <div
          aria-hidden
          data-testid="atp-segment-committed"
          className={cn(
            "absolute inset-y-0 left-0 w-full origin-left rounded-l-full",
            "bg-gradient-to-b from-forest-500 to-forest-700",
            "shadow-[0_0_10px_-2px_rgba(9,59,42,0.55)]",
            "will-change-transform transition-transform duration-500 ease-out",
          )}
          style={{ transform: `scaleX(${committedRatio})` }}
        >
          {/* Inner gloss so the slab reads as lit, not flat. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-l-full bg-gradient-to-b from-white/35 via-white/5 to-black/10"
          />
        </div>

        {/* Available (ATP) slab — honey, anchored to the right edge so it
            grows in from the open end as availability rises. */}
        <div
          aria-hidden
          data-testid="atp-segment-available"
          className={cn(
            "absolute inset-y-0 right-0 w-full origin-right rounded-r-full",
            "bg-gradient-to-b from-honey to-honey-700",
            "shadow-[0_0_10px_-2px_rgba(200,146,46,0.55)]",
            "will-change-transform transition-transform duration-500 ease-out",
          )}
          style={{ transform: `scaleX(${availableRatio})` }}
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-r-full bg-gradient-to-b from-white/40 via-white/8 to-black/10"
          />
        </div>
      </div>

      {/* Legend / readouts — each on its own opaque chip (AD-3). */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          data-testid="atp-readout-committed"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-forest px-2 py-0.5",
            "font-medium text-white shadow-[0_1px_2px_rgba(27,23,18,0.18)]",
          )}
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-forest-300"
          />
          <span className="tabular-nums">{kg(committed)}</span>
          <span className="text-white/70">{t("atpMeter.committed")}</span>
        </span>

        <span
          data-testid="atp-readout-total"
          className="tabular-nums text-muted-fg"
        >
          {kg(total)} {t("atpMeter.total")}
        </span>

        <span
          data-testid="atp-readout-available"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-honey-100 px-2 py-0.5",
            "font-semibold text-honey-700 shadow-[0_1px_2px_rgba(27,23,18,0.12)]",
          )}
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-honey" />
          <span className="tabular-nums">{kg(available)}</span>
          <span className="font-medium text-honey-700/80">
            {t("atpMeter.available")}
          </span>
        </span>
      </div>
    </div>
  );
}
