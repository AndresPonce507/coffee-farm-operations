/**
 * Shared drying-station label maps — the single source for the station-kind
 * translation key and the forecast-weekday key, imported by the board, the dossier
 * page, and the capacity/weather sections (kills the 3-file KIND_KEY duplication).
 * Pure data (no React, no next-intl) so it's usable from server + client alike.
 */

/** A `drying_stations.kind` value → its `drying.stations.*` translation key. */
export const STATION_KIND_KEY: Record<string, string> = {
  patio: "stations.kindPatio",
  "raised-bed": "stations.kindRaisedBed",
  guardiola: "stations.kindGuardiola",
  parabolic: "stations.kindParabolic",
};

const WEEKDAY: Record<string, string> = {
  today: "weekday.today",
  mon: "weekday.mon",
  tue: "weekday.tue",
  wed: "weekday.wed",
  thu: "weekday.thu",
  fri: "weekday.fri",
  sat: "weekday.sat",
  sun: "weekday.sun",
};

/**
 * The forecast-day token from the weather feed ("Today"/"Mon"/"Sat"…) → its
 * `drying.weekday.*` key, so a day label is localized instead of leaking raw English
 * into the Spanish UI. Returns null for an unrecognized token (caller falls back to
 * rendering it verbatim).
 */
export function weekdayKey(day: string): string | null {
  return WEEKDAY[day.trim().toLowerCase()] ?? null;
}
