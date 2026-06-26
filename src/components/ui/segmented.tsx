"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption {
  id: string;
  label: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** Accessible name for the radiogroup. Required so a reused group is not mislabeled
   *  "View mode" (e.g. a defect Band toggle). Defaults to "View mode" for legacy callers. */
  ariaLabel?: string;
}

export function Segmented({
  options,
  value,
  onChange,
  className,
  ariaLabel = "View mode",
}: SegmentedProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-xl border border-white/60 bg-white/50 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300",
              isActive
                ? "glass-card text-ink shadow-sm"
                : "text-muted-fg hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
