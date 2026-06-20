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
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300",
        active
          ? "border-forest bg-forest text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_12px_-4px_rgba(0,41,29,0.45)]"
          : "border-white/60 bg-white/55 text-muted-fg hover:-translate-y-0.5 hover:border-white/80 hover:bg-white/70 hover:text-ink hover:shadow-[0_6px_16px_-8px_rgba(0,41,29,0.35)]",
        className,
      )}
    >
      {children}
    </button>
  );
}
