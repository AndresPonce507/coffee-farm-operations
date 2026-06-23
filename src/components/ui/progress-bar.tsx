import { cn } from "@/lib/utils";

type ProgressTone = "forest" | "honey" | "cherry" | "coffee" | "sky";

const TONE_FILL: Record<ProgressTone, string> = {
  forest: "bg-forest-500",
  honey: "bg-honey",
  cherry: "bg-cherry",
  coffee: "bg-coffee-400",
  sky: "bg-sky",
};

/** Faint tone-matched glow so the fill reads as lit rather than flat. */
const TONE_GLOW: Record<ProgressTone, string> = {
  forest: "shadow-[0_0_10px_-2px_rgba(31,107,71,0.55)]",
  honey: "shadow-[0_0_10px_-2px_rgba(200,146,46,0.55)]",
  cherry: "shadow-[0_0_10px_-2px_rgba(193,52,52,0.5)]",
  coffee: "shadow-[0_0_10px_-2px_rgba(120,83,52,0.5)]",
  sky: "shadow-[0_0_10px_-2px_rgba(56,135,190,0.5)]",
};

export interface ProgressBarProps {
  /** Progress percentage, 0–100. Values outside the range are clamped. */
  value: number;
  /** Fill color, mapped to a brand token. Defaults to forest. */
  tone?: ProgressTone;
  /** Extra classes applied to the outer track element. */
  className?: string;
}

export function ProgressBar({ value, tone = "forest", className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full border border-white/40 bg-muted",
        "shadow-[inset_0_1px_1px_rgba(31,41,37,0.06)]",
        className,
      )}
    >
      <div
        data-testid="progress-fill"
        className={cn(
          // GPU-only fill: a full-width slab anchored left, sized by
          // transform: scaleX() — no `width` reflow, no JS tween. The global
          // prefers-reduced-motion rule zeroes the duration; motion-reduce
          // belt-and-braces drops the transition entirely.
          "relative h-full w-full origin-left rounded-full",
          "will-change-transform transition-transform duration-500 ease-out",
          "motion-reduce:transition-none",
          TONE_FILL[tone],
          TONE_GLOW[tone],
        )}
        style={{ transform: `scaleX(${clamped / 100})` }}
      >
        {/* Inner gloss: top highlight fading to a soft floor, painted over the tone fill. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-gradient-to-b from-white/45 via-white/10 to-black/10"
        />
        {/* Specular cap on the leading edge for a lit, liquid finish. */}
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 w-1/3 rounded-full bg-gradient-to-l from-white/30 to-transparent"
        />
      </div>
    </div>
  );
}
