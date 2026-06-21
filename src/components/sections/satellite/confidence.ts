import type { BadgeTone } from "@/components/ui/badge";
import type { VegetationConfidence } from "@/lib/types";

/**
 * P2-S12 · The HONEST confidence badge vocabulary. The cloud is never hidden — a
 * fused vegetation read always carries a high/medium/low badge, and a SAR-carried
 * read says "radar" plainly. These pure helpers keep the badge copy + tone in one
 * place so the satellite grid and any future map layer agree.
 */

/** Badge tone per confidence — green when clear, honey when SAR-carried, neutral when blind. */
export function confidenceTone(c: VegetationConfidence): BadgeTone {
  switch (c) {
    case "high":
      return "forest";
    case "medium":
      return "honey";
    case "low":
      return "neutral";
  }
}

/** The honest badge label, naming the basis so a SAR fallback reads "radar · medium". */
export function confidenceLabel(c: VegetationConfidence, basis: "optical" | "sar"): string {
  if (c === "low") return "low confidence";
  const source = basis === "sar" ? "radar" : "optical";
  return `${source} · ${c}`;
}

/** A short, plain-language note for the no-signal / low state — surfaced, not hidden. */
export function confidenceNote(c: VegetationConfidence, basis: "optical" | "sar"): string {
  if (c === "low") return "No clear signal — cloudy or no recent pass. Honestly unknown.";
  if (basis === "sar") return "Optical cloudy/stale — carried by cloud-penetrating radar.";
  return "Recent, low-cloud optical read.";
}
