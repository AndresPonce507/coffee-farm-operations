import { cn } from "@/lib/utils";

export interface ChipProps {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * Filter chip — a plain button with no internal state. Parent owns
 * `active` and `onClick`, so it works inside client components while
 * staying a server component itself.
 */
export function Chip({ active = false, children, onClick, className }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-forest text-paper border-forest"
          : "bg-card text-muted-fg border-line hover:text-ink hover:border-line-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}
