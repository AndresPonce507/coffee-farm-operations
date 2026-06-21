"use client";

import { Coffee, Scale } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WeighTally — the running per-picker total shown back after every capture: today's
 * kg + lata count for the selected picker, plus the farm's day total. The satisfying
 * "weight captured" feedback is owned by the parent island; this is the always-on
 * scoreboard so a supervisor trusts the number is climbing. Pure presentation.
 */

export interface WeighTallyProps {
  /** Selected picker's name (or null when none badged). */
  pickerName: string | null;
  /** Selected picker's kg today. */
  pickerKgToday: number;
  /** Selected picker's lata count today. */
  pickerLatas: number;
  /** Farm-wide kg captured today (all pickers). */
  farmKgToday: number;
  className?: string;
}

export function WeighTally({
  pickerName,
  pickerKgToday,
  pickerLatas,
  farmKgToday,
  className,
}: WeighTallyProps) {
  return (
    <div
      className={cn("glass-card grid grid-cols-2 rounded-2xl", className)}
      aria-live="polite"
    >
      <div className="flex flex-col gap-0.5 border-r border-line px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
          <Scale className="h-3.5 w-3.5" aria-hidden="true" />
          {pickerName ?? "This picker"} · today
        </span>
        <span className="font-display text-2xl font-bold tabular-nums text-ink">
          {pickerKgToday.toFixed(1)}
          <span className="ml-1 text-sm font-medium text-muted-fg">kg</span>
        </span>
        <span className="text-[11px] text-muted-fg">
          {pickerLatas} {pickerLatas === 1 ? "lata" : "latas"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
          <Coffee className="h-3.5 w-3.5" aria-hidden="true" />
          Farm · today
        </span>
        <span className="font-display text-2xl font-bold tabular-nums text-forest">
          {farmKgToday.toFixed(1)}
          <span className="ml-1 text-sm font-medium text-muted-fg">kg</span>
        </span>
      </div>
    </div>
  );
}
