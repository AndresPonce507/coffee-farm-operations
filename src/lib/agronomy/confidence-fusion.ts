/**
 * P2-S12 · Remote-sensing confidence fusion — the pure, DB-free vegetation model.
 *
 * Volcán sits under near-daily cloud, so an optical-only NDVI tool is blind half
 * the year. The differentiator here is HONESTY about that: every plot read fuses
 * the optical (Sentinel-2 NDVI/NDRE) signal with the cloud-penetrating SAR
 * (Sentinel-1 backscatter) signal, and emits a confidence level that is NEVER
 * hidden. When optical is clear and recent → HIGH (optical-led). When optical is
 * cloudy or stale but SAR is available → MEDIUM (SAR fallback, badge says
 * "radar"). When neither is trustworthy → LOW — surfaced plainly, not a footnote.
 *
 * This module is the SSOT for the fusion math: the SQL `v_plot_vegetation` view
 * mirrors these exact rules, so the badge in the UI and the value in the DB always
 * agree, and the whole thing is exhaustively unit-testable at $0.
 */

import type { VegetationConfidence } from "@/lib/types";

/** A satellite source. */
export type VegetationSource = "sentinel-2" | "sentinel-1-sar";

/** The index a reading carries. NDVI/NDRE are optical; backscatter is SAR. */
export type VegetationIndexKind = "ndvi" | "ndre" | "sar-backscatter";

/** Which signal the fused read is based on (drives the honest badge copy). */
export type VegetationBasis = "optical" | "sar";

/** One raw satellite observation for a plot. */
export interface VegetationObservation {
  source: VegetationSource;
  indexKind: VegetationIndexKind;
  /** The index value (NDVI/NDRE in [0,1]; SAR backscatter normalised to ~[0,1]). */
  value: number;
  /** Scene cloud cover at capture (%). SAR is cloud-immune (0). */
  cloudPct: number;
  /** ISO timestamp the scene was observed. */
  observedAt: string;
}

/** The fused vegetation read for a plot — value + an HONEST confidence badge. */
export interface FusedVegetation {
  /** The chosen index value, or null when there is no trustworthy signal. */
  value: number | null;
  /** The honest confidence level — always surfaced. */
  confidence: VegetationConfidence;
  /** Which signal carried the read (drives "optical" vs "radar" badge copy). */
  basis: VegetationBasis;
}

/**
 * How many days an optical read stays "fresh". Past this it is treated as stale
 * and SAR (if present) carries the read. CALIBRATION FLAG: a transparent v1
 * constant (~12 days ≈ Sentinel-2's revisit under partial cloud), family-tunable.
 */
export const OPTICAL_STALE_DAYS = 12;

/**
 * The cloud-cover ceiling (%) above which an optical scene is considered too
 * cloud-blinded to trust. CALIBRATION FLAG: a transparent v1 constant.
 */
export const CLOUD_OPTICAL_CEILING_PCT = 40;

const MS_PER_DAY = 86_400_000;

/** Most-recent observation of a given source, or undefined if none. */
function latest(
  obs: ReadonlyArray<VegetationObservation>,
  source: VegetationSource,
): VegetationObservation | undefined {
  return obs
    .filter((o) => o.source === source)
    .reduce<VegetationObservation | undefined>((best, o) => {
      if (!best) return o;
      return new Date(o.observedAt).getTime() > new Date(best.observedAt).getTime()
        ? o
        : best;
    }, undefined);
}

/** Age of an observation in whole-ish days relative to `asOf`. */
function ageDays(observedAt: string, asOf: string): number {
  return (new Date(asOf).getTime() - new Date(observedAt).getTime()) / MS_PER_DAY;
}

/**
 * Fuse a plot's satellite observations into one read + an honest confidence badge.
 *
 * Decision order (mirrored by `v_plot_vegetation`):
 *   1. A recent (≤ OPTICAL_STALE_DAYS) AND low-cloud (≤ ceiling) optical read →
 *      HIGH, optical-led — the richest, most-trustworthy signal.
 *   2. Optical too cloudy/stale BUT a SAR read exists → MEDIUM, SAR fallback.
 *   3. Optical present but cloudy/stale and NO SAR → LOW, optical-led (best
 *      available, flagged honestly).
 *   4. Nothing usable → LOW with a null value (an honest unknown, never hidden).
 */
export function fuseVegetation(
  observations: ReadonlyArray<VegetationObservation>,
  asOf: string,
): FusedVegetation {
  const optical = latest(observations, "sentinel-2");
  const radar = latest(observations, "sentinel-1-sar");

  const opticalUsable =
    optical !== undefined &&
    optical.cloudPct <= CLOUD_OPTICAL_CEILING_PCT &&
    ageDays(optical.observedAt, asOf) <= OPTICAL_STALE_DAYS;

  if (opticalUsable && optical) {
    return { value: optical.value, confidence: "high", basis: "optical" };
  }

  if (radar) {
    return { value: radar.value, confidence: "medium", basis: "sar" };
  }

  if (optical) {
    // an optical read exists but it is cloudy/stale and there is no SAR to rescue
    // it — return it as the best available, but be HONEST: low confidence.
    return { value: optical.value, confidence: "low", basis: "optical" };
  }

  return { value: null, confidence: "low", basis: "optical" };
}
