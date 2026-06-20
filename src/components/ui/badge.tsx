import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "forest"
  | "coffee"
  | "honey"
  | "cherry"
  | "sky"
  | "ok"
  | "warn"
  | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-fg",
  forest: "bg-forest-100 text-forest",
  coffee: "bg-coffee-200/50 text-coffee",
  honey: "bg-honey-100 text-honey-700",
  cherry: "bg-cherry-100 text-cherry",
  sky: "bg-sky-100 text-sky",
  ok: "bg-forest-100 text-forest-600",
  warn: "bg-honey-100 text-honey-700",
  danger: "bg-cherry-100 text-cherry",
};

/**
 * Badge — compact status / category pill.
 * Optional leading dot for status semantics.
 */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONES[tone],
        className
      )}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      )}
      {children}
    </span>
  );
}
