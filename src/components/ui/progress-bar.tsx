import { cn } from "@/lib/utils";

type ProgressTone = "forest" | "honey" | "cherry" | "coffee" | "sky";

const TONE_FILL: Record<ProgressTone, string> = {
  forest: "bg-forest-500",
  honey: "bg-honey",
  cherry: "bg-cherry",
  coffee: "bg-coffee-400",
  sky: "bg-sky",
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
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          TONE_FILL[tone],
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
