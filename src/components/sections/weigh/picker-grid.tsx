"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * PickerGrid — "badge the picker": tap a worker from a glove-friendly grid of glass
 * cards (the offline-preloaded crew). Each card is a big touch target showing the
 * picker's name, their crew, and today's running kg so the supervisor can see at a
 * glance who has weighed what. Selected state is ring + check + tint (never colour
 * alone). Pure presentation — the island owns the selection.
 */

export interface PickerOption {
  workerId: string;
  name: string;
  crewName?: string | null;
  /** Today's running kg for this picker (0 when none yet). */
  kgToday?: number;
}

export interface PickerGridProps {
  pickers: PickerOption[];
  selectedId: string | null;
  onSelect: (workerId: string) => void;
  className?: string;
}

export function PickerGrid({
  pickers,
  selectedId,
  onSelect,
  className,
}: PickerGridProps) {
  const t = useTranslations("weigh");
  if (pickers.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-white/50 px-4 py-6 text-center text-sm text-muted-fg">
        {t("pickerGrid.empty")}
      </p>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label={t("pickerGrid.ariaLabel")}
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {pickers.map((p) => {
        const selected = selectedId === p.workerId;
        return (
          <button
            key={p.workerId}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(p.workerId)}
            className={cn(
              "glass-card flex min-h-[72px] flex-col items-start justify-center gap-0.5 rounded-2xl px-3.5 py-3 text-left transition-all duration-200 will-change-transform",
              "ring-1 ring-line motion-safe:active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100",
              selected ? "bg-forest-100 ring-2 ring-forest" : "hover:bg-white/70",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink">
                {p.name}
              </span>
              {selected && (
                <Check className="h-4 w-4 shrink-0 text-forest" aria-hidden="true" />
              )}
            </span>
            <span className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-fg">
              <span className="truncate">{p.crewName ?? "—"}</span>
              {p.kgToday ? (
                <span className="shrink-0 tabular-nums font-medium text-forest">
                  {p.kgToday.toFixed(1)} kg
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
