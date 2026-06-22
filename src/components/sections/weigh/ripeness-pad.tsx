"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { RIPENESS_LABELS, bothLangs } from "./labels";

/**
 * RipenessPad — the one-tap ripeness call: three BIG glass buttons (underripe /
 * ripe / overripe), glove-friendly (≥ 64px tall touch targets), bilingual, with a
 * clear selected state conveyed by ring + check icon + text (never colour alone, so
 * it reads on glass and for colour-blind pickers). Pure presentation — the parent
 * island owns the value; this only emits the choice.
 */

export const RIPENESS_ORDER = ["underripe", "ripe", "overripe"] as const;
export type RipenessValue = (typeof RIPENESS_ORDER)[number];

/**
 * Per-value accent — a calm forest/honey/cherry scale, plus a neutral resting tint.
 * The `on` text colour is the *dark* grade of each accent so BOTH the es label and the
 * full-opacity ngäbere sublabel clear WCAG-AA (≥4.5:1) on the selected tint — critical
 * for a ~90% Ngäbe-Buglé crew reading the bilingual line on a field tablet in bright sun.
 * honey-700 on honey-100 = 4.84:1, forest on forest-100 = 12.4:1, and cherry-700
 * (#8a2f1c, no token yet) on cherry-100 = 6.47:1 (plain text-cherry was only 4.12:1 → failed).
 */
const ACCENT: Record<RipenessValue, { ring: string; on: string }> = {
  underripe: { ring: "ring-honey-700", on: "bg-honey-100 text-honey-700" },
  ripe: { ring: "ring-forest", on: "bg-forest-100 text-forest" },
  overripe: { ring: "ring-cherry", on: "bg-cherry-100 text-[#8a2f1c]" },
};

export interface RipenessPadProps {
  value: RipenessValue | null;
  onChange: (value: RipenessValue) => void;
  className?: string;
}

export function RipenessPad({ value, onChange, className }: RipenessPadProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Ripeness"
      className={cn("grid grid-cols-3 gap-2.5", className)}
    >
      {RIPENESS_ORDER.map((r) => {
        const selected = value === r;
        const label = RIPENESS_LABELS[r];
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(r)}
            className={cn(
              "glass-card flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3 text-center transition-all duration-200 will-change-transform",
              "ring-1 ring-line motion-safe:active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100",
              selected
                ? cn("ring-2", ACCENT[r].ring, ACCENT[r].on)
                : "text-ink hover:bg-white/70",
            )}
          >
            {selected && <Check className="h-4 w-4" aria-hidden="true" />}
            <span className="text-sm font-semibold capitalize leading-tight">
              {label.es}
            </span>
            <span className="text-[11px] leading-tight">{label.ng}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Convenience for screen-reader / aria text. */
export function ripenessAria(r: RipenessValue): string {
  return bothLangs(RIPENESS_LABELS[r]);
}
