/**
 * i18n configuration — the EN⇄ES toggle that makes the whole estate bilingual.
 *
 * Locale is cookie-driven (NEXT_LOCALE), NOT URL-routed: the topbar toggle sets the
 * cookie + refreshes, so routes never change. Messages are split per namespace (one
 * JSON file per area under messages/<locale>/) so the extraction work parallelizes
 * without merge conflicts; `request.ts` merges them back into one message tree.
 */
export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** The cookie the topbar toggle writes; read by `request.ts` on every render. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Human label per locale for the toggle. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/**
 * Every message namespace (one file per area: messages/<locale>/<ns>.json). Keep in
 * sync with the files on disk — `request.ts` imports exactly this list, so adding an
 * area means adding it here AND creating its two JSON files.
 */
export const NAMESPACES = [
  "common", "ui", "layout", "auth", "dossier", "map", "scouting", "audit",
  "costing", "crew", "dashboard", "dispatch", "drying", "eudr", "ferment",
  "harvests", "hedge", "inventory", "ipm", "lots", "payPeriod", "payroll", "planning",
  "plots", "pricing", "processing", "qc", "satellite", "tasks", "weigh", "workers",
  // P3 Wave 1 commerce cluster (S1 trade trunk, S2 samples, S3 export docs, S4 auctions)
  "sales", "samples", "shipments", "auctions",
  // P3 Wave 2 milling, roasting, and yield-reference cluster (S6-S10)
  "mill", "millBalance", "millFinalize", "roast", "yields",
  // P3 Wave 3 DTC commerce cluster (S11 storefront SKUs, S12 orders+subs, S13 provenance, S14 POS)
  "shop", "orders", "subscriptions", "provenance", "pos",
  // P3 Wave 4 accounting cluster (S16 accounting spine / AR, S17 accounting sync + margin view)
  "finance", "margins",
] as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
