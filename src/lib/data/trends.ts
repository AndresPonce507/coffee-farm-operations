import type { TrendPoint, VarietyShare } from "@/lib/types";

/**
 * Dashboard trend aggregates for Janson Coffee — Farm Operations.
 *
 * All values are deterministic literals (no Math.random / Date.now) so the
 * dashboard renders identically on server and client. Numbers are grounded in
 * the canonical plots (@/lib/data/plots): the variety shares roughly mirror
 * season-to-date harvested kg per variety, and the totals tie to SEASON below.
 *
 * "Today" for this mock dataset is 2026-06-20, mid-harvest peak in Volcán.
 */

/**
 * Daily cherry intake (kg) over the last 14 days, "Jun 7"…"Jun 20".
 * Trends upward toward the harvest peak with a natural day-to-day wobble.
 */
export const dailyCherries: TrendPoint[] = [
  { label: "Jun 7", value: 382 },
  { label: "Jun 8", value: 414 },
  { label: "Jun 9", value: 401 },
  { label: "Jun 10", value: 448 },
  { label: "Jun 11", value: 472 },
  { label: "Jun 12", value: 459 },
  { label: "Jun 13", value: 503 },
  { label: "Jun 14", value: 538 },
  { label: "Jun 15", value: 521 },
  { label: "Jun 16", value: 564 },
  { label: "Jun 17", value: 597 },
  { label: "Jun 18", value: 631 },
  { label: "Jun 19", value: 688 },
  { label: "Jun 20", value: 642 },
];

/**
 * Weekly harvested cherries (kg) across the first 8 weeks of the season,
 * "Wk 1"…"Wk 8", rising from the early ripening trickle to the current peak.
 */
export const weeklyHarvest: TrendPoint[] = [
  { label: "Wk 1", value: 2040 },
  { label: "Wk 2", value: 3180 },
  { label: "Wk 3", value: 4260 },
  { label: "Wk 4", value: 5120 },
  { label: "Wk 5", value: 6340 },
  { label: "Wk 6", value: 7480 },
  { label: "Wk 7", value: 8620 },
  { label: "Wk 8", value: 9480 },
];

/**
 * Season-to-date harvested cherries by variety (kg). Mirrors the plot mix:
 * Caturra and Catuaí are the volume backbone, Typica is mid, and Geisha —
 * the premium lots — is intentionally smaller. Sums to SEASON.harvestedKg.
 */
export const varietyShares: VarietyShare[] = [
  { variety: "Caturra", kg: 36700 },
  { variety: "Catuaí", kg: 30540 },
  { variety: "Geisha", kg: 26000 },
  { variety: "Typica", kg: 17800 },
  { variety: "Pacamara", kg: 11200 },
];

/**
 * Season-level headline figures for the dashboard hero / stat cards.
 * targetKg: full-season cherry target across all plots.
 * harvestedKg: season-to-date intake (≈ 64% of target, mid-peak).
 * todayKg: cherries received today (ties to dailyCherries "Jun 20").
 * ytdRevenueUsd: green-coffee + cherry sales recognized this season to date.
 */
export const SEASON = {
  targetKg: 190000,
  harvestedKg: 122240,
  todayKg: 642,
  ytdRevenueUsd: 486500,
} as const;
