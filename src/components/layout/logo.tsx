import { cn } from "@/lib/utils";

/**
 * Janson mark — a minimal line-art recreation of the brand motif:
 * the Talamanca peaks (Volcán Barú / Tizingal) with a bird in flight above.
 * Uses currentColor so it inherits cream-on-forest in the sidebar.
 */
export function JansonMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-7 w-7", className)}
      aria-hidden="true"
    >
      {/* bird in flight */}
      <path d="M16 13c2.4-2.2 5-2.2 8 0 3-2.2 5.6-2.2 8 0" />
      {/* twin peaks */}
      <path d="M7 36l9-15 5 8 4-7 7 14" />
      <path d="M24 22l4 7" opacity={0.5} />
      {/* ground line */}
      <path d="M5 39h38" opacity={0.65} />
    </svg>
  );
}

/** Full lockup: mark + wordmark, for the sidebar header. */
export function JansonLogo({
  className,
  subtitle = "Farm Operations",
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <JansonMark className="h-8 w-8 shrink-0" />
      <div className="leading-tight">
        <div className="font-display text-[15px] font-bold tracking-wide">
          JANSON
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">
          {subtitle}
        </div>
      </div>
    </div>
  );
}
