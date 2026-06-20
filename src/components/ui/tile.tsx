import { cn } from "@/lib/utils";

export type TileAccent =
  | "forest"
  | "honey"
  | "cherry"
  | "coffee"
  | "sky"
  | "ink";

/** accent -> icon chip class (full literal strings; never interpolated). */
const ACCENTS: Record<TileAccent, string> = {
  ink: "bg-muted/70 text-ink",
  forest: "bg-forest-100/70 text-forest",
  honey: "bg-honey-100/70 text-honey-700",
  cherry: "bg-cherry-100/70 text-cherry",
  coffee: "bg-coffee-200/40 text-coffee",
  sky: "bg-sky-100/70 text-sky",
};

/**
 * Tile — compact stat tile for summary strips.
 * Borderless by design: meant to sit inside a divided Card grid.
 */
export function Tile({
  label,
  value,
  sub,
  accent = "ink",
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: TileAccent;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("p-4", className)}>
      {Icon && (
        <span
          className={cn(
            "grid h-9 w-9 place-items-center rounded-xl border border-white/50 shadow-sm",
            ACCENTS[accent]
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="mt-3 text-xs uppercase tracking-wide text-muted-fg">
        {label}
      </p>
      <p className="font-display text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="text-xs text-muted-fg">{sub}</p>}
    </div>
  );
}
