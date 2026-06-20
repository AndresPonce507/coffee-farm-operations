import { initials, cn } from "@/lib/utils";

type AvatarSize = "sm" | "md";

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

const palette = [
  "bg-forest",
  "bg-coffee",
  "bg-cherry",
  "bg-forest-600",
  "bg-sky",
] as const;

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
};

/** Deterministic initials avatar with a brand-palette background derived from the name. */
export function Avatar({ name, size = "sm", className }: AvatarProps) {
  const colorIndex =
    [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;

  return (
    <span
      title={name}
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-paper",
        "ring-1 ring-white/60 shadow-sm shadow-ink/10",
        sizeClasses[size],
        palette[colorIndex],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
