"use client";

import { Delete, Scale } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WeighNumericPad — the giant, glove-friendly numeric pad: the ALWAYS-available
 * manual-entry path (BLE scale is the optional upgrade). Big keys (≥ 56px), a live
 * kg readout, a decimal + backspace, and an optional "Try scale" affordance the
 * parent wires to the BLE port. Controlled: the parent owns the string value; this
 * only appends/edits digits and emits the new string.
 */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

export interface WeighNumericPadProps {
  /** The current kg string (e.g. "12.4"); the parent is the source of truth. */
  value: string;
  onChange: (next: string) => void;
  /** When provided, renders a "Try scale" key that pairs a BLE scale. */
  onTryScale?: () => void;
  /** True while the BLE pairing is in flight (disables the scale key). */
  scaleBusy?: boolean;
  className?: string;
}

/** Apply one keypress to the kg string — pure, so it is unit-tested directly. */
export function applyKey(value: string, key: string): string {
  if (key === "back") return value.slice(0, -1);
  if (key === ".") {
    if (value.includes(".")) return value; // one decimal point only
    return value === "" ? "0." : value + ".";
  }
  // digit: block a leading zero run (so "007" can't form) and cap one decimal place
  // of precision past the point (kg to 0.1 is plenty for a lata; keeps it tidy).
  const next = value === "0" ? key : value + key;
  const dot = next.indexOf(".");
  if (dot !== -1 && next.length - dot - 1 > 1) return value; // >1 decimal → ignore
  return next;
}

export function WeighNumericPad({
  value,
  onChange,
  onTryScale,
  scaleBusy = false,
  className,
}: WeighNumericPadProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div
        className="glass-card flex items-baseline justify-end gap-2 rounded-2xl px-5 py-4"
        aria-live="polite"
      >
        <span
          data-testid="kg-readout"
          className="font-display text-5xl font-bold tabular-nums tracking-tight text-ink"
        >
          {value === "" ? "0" : value}
        </span>
        <span className="text-lg font-medium text-muted-fg">kg</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {KEYS.map((k) =>
          k === "back" ? (
            <button
              key={k}
              type="button"
              onClick={() => onChange(applyKey(value, "back"))}
              aria-label="Delete last digit"
              className="glass-card flex min-h-[58px] items-center justify-center rounded-2xl text-muted-fg ring-1 ring-line transition-all duration-150 will-change-transform hover:text-ink motion-safe:active:scale-[.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100"
            >
              <Delete className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => onChange(applyKey(value, k))}
              aria-label={k === "." ? "Decimal point" : `Digit ${k}`}
              className="glass-card flex min-h-[58px] items-center justify-center rounded-2xl font-display text-2xl font-semibold tabular-nums text-ink ring-1 ring-line transition-all duration-150 will-change-transform hover:bg-white/70 motion-safe:active:scale-[.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100"
            >
              {k}
            </button>
          ),
        )}
      </div>

      {onTryScale && (
        <button
          type="button"
          onClick={onTryScale}
          disabled={scaleBusy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white/55 py-3 text-sm font-medium text-forest transition hover:bg-white/75 disabled:opacity-60"
        >
          <Scale className="h-4 w-4" aria-hidden="true" />
          {scaleBusy ? "Connecting scale…" : "Try a Bluetooth scale"}
        </button>
      )}
    </div>
  );
}
