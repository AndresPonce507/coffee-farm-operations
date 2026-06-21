import type { ReadinessConfidence } from "@/lib/types";

/**
 * Pure presentation logic for the harvest planner — maps a DERIVED readiness score
 * (computed in v_harvest_readiness, never a hand-set flag) and its honest
 * confidence onto a glass tone + human phrase. No DB, no React — exhaustively
 * unit-tested so the UI's color/label decisions are provably correct.
 */

export type ReadinessTone = "ready" | "approaching" | "early";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Thresholds on the [0,1] readiness scale. */
const READY_AT = 0.8; // ≥ this → clear to pick
const APPROACHING_AT = 0.45; // ≥ this → ripening, days out

/** Map readiness to a glass tone (drives the meter + chip color). */
export function readinessTone(readiness: number): ReadinessTone {
  const r = clamp01(readiness);
  if (r >= READY_AT) return "ready";
  if (r >= APPROACHING_AT) return "approaching";
  return "early";
}

/** A human-readable readiness phrase for the plot card. */
export function readinessLabel(readiness: number): string {
  switch (readinessTone(readiness)) {
    case "ready":
      return "Ready to pick";
    case "approaching":
      return "Approaching — days out";
    case "early":
      return "Developing — weeks early";
  }
}

/** The honest confidence note — surfaced, never hidden (DESIGN P2-S8). */
export function confidenceLabel(confidence: ReadinessConfidence): string {
  switch (confidence) {
    case "high":
      return "High confidence — bloom logged + corroborated";
    case "medium":
      return "Medium confidence — bloom logged";
    case "low":
      return "Low confidence — GDD estimate only, log a bloom to sharpen";
  }
}

/** Tailwind tokens per tone — full literal strings (never interpolated, so the
 *  Tailwind JIT keeps them). */
export const TONE_STYLES: Record<
  ReadinessTone,
  { bar: string; dot: string; text: string; ring: string }
> = {
  ready: {
    bar: "bg-forest",
    dot: "bg-forest",
    text: "text-forest",
    ring: "ring-forest/30",
  },
  approaching: {
    bar: "bg-honey",
    dot: "bg-honey",
    text: "text-honey-700",
    ring: "ring-honey/30",
  },
  early: {
    bar: "bg-sky",
    dot: "bg-sky",
    text: "text-sky",
    ring: "ring-sky/30",
  },
};
