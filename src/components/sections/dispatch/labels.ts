/* ====================================================================== */
/* Bilingual (es / ngäbere) field-facing labels for the morning DISPATCH   */
/* card (P2-S5). Owner builds the card in Spanish; the crew reads it in the */
/* field — and many Janson pickers speak ngäbere, not Spanish.             */
/*                                                                          */
/* 🚨 PLACEHOLDER TRANSLATIONS — the ngäbere strings below are best-effort  */
/* PLACEHOLDERS and MUST be reviewed by a native Ngäbe-Buglé speaker before */
/* this reaches the field. They exist so the bilingual affordance renders   */
/* today; they are NOT authoritative. Do NOT ship to production copy as-is. */
/*                                                                          */
/* Each entry pairs the Spanish (es) farm-office term with its ngäbere       */
/* counterpart. Field-facing strings show "es · ngäbere" when the crew      */
/* speaks ngäbere (driven by the crew's `languages` array).                 */
/* ====================================================================== */

import type { RipenessTarget } from "@/lib/types";

/** A single bilingual term: Spanish + its (placeholder) ngäbere rendering.
 *  Re-declared locally (not imported from crew/labels.ts) to keep this
 *  dispatch surface file-disjoint and free of cross-section coupling. */
export interface BilingualLabel {
  /** Spanish — the farm-office canonical term. */
  es: string;
  /** Ngäbere — 🚨 PLACEHOLDER, pending native-speaker review. */
  ng: string;
}

/**
 * Standing field-facing terms used to build the dispatch card copy.
 * 🚨 The `ng` values are placeholders — review with a Ngäbe-Buglé speaker.
 */
export const DISPATCH_TERMS = {
  /** Card greeting. */
  goodMorning: { es: "Buenos días", ng: "Dekä kwin" },
  /** The headline call to action. */
  pickToday: { es: "A cosechar hoy", ng: "Ñö ötö matare" },
  /** Plural "plots/parcels". */
  plots: { es: "parcelas", ng: "kä nura" },
  /** Singular "plot/parcel". */
  plot: { es: "parcela", ng: "kä" },
  /** "ripe". */
  ripe: { es: "maduro", ng: "ngwä döin" },
  /** "harvest pass" (a pasada). */
  pasada: { es: "pasada", ng: "ñö ötö" },
  /** Per-plot order hint, e.g. "pasada order". */
  pasadaOrder: { es: "orden de pasada", ng: "ñö ötö kä" },
  /** "ready today". */
  readyToday: { es: "listo hoy", ng: "döin matare" },
  /** "masl" altitude unit suffix. */
  masl: { es: "msnm", ng: "msnm" },
  /** "target" (per-plot kg target). */
  target: { es: "meta", ng: "meta" },
  /** Empty-card line: nothing ready to pick today. */
  noPlots: {
    es: "Ninguna parcela lista para hoy",
    ng: "Kä ñakare döin matare",
  },
} as const satisfies Record<string, BilingualLabel>;

/** Field-facing ripeness band names, by `RipenessTarget`. */
export const RIPENESS_LABELS: Record<RipenessTarget, BilingualLabel> = {
  high: { es: "muy maduro", ng: "ngwä döin krö" },
  medium: { es: "maduro", ng: "ngwä döin" },
  low: { es: "casi maduro", ng: "ngwä döin braibe" },
};

/** Matches "ngäbere" or its ascii "ngabere" spelling, any case. */
const NGABERE_RE = /ng(ä|a)bere/i;

/**
 * Render a bilingual term as "es · ngäbere" when the crew speaks ngäbere,
 * otherwise just the Spanish. `languages` is the crew row's array. When the
 * label is missing, the provided `fallback` is returned verbatim.
 */
export function bilingual(
  label: BilingualLabel | undefined,
  languages: string[],
  fallback: string,
): string {
  if (!label) return fallback;
  return speaksNgabere(languages) ? `${label.es} · ${label.ng}` : label.es;
}

/** True when this crew speaks ngäbere (drives the bilingual card rendering). */
export function speaksNgabere(languages: string[]): boolean {
  return languages.some((l) => NGABERE_RE.test(l));
}
