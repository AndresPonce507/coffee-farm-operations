/* ====================================================================== */
/* Bilingual (es / ngäbere) field-facing labels for the weigh surface.     */
/*                                                                          */
/* 🚨 PLACEHOLDER TRANSLATIONS — the ngäbere strings below are best-effort  */
/* PLACEHOLDERS and MUST be reviewed by a native Ngäbe-Buglé speaker before */
/* this reaches the field. They render the bilingual affordance today (many */
/* of Janson's crew speak ngäbere, not Spanish, in the field); they are NOT */
/* authoritative. Do not ship as production copy as-is.                     */
/* ====================================================================== */

/** A single bilingual term: Spanish + its (placeholder) ngäbere rendering. */
export interface BilingualLabel {
  es: string;
  ng: string;
}

/** The three ripeness taps — the one-tap quality call on every lata. */
export const RIPENESS_LABELS: Record<string, BilingualLabel> = {
  underripe: { es: "verde", ng: "ñaka nüre" },
  ripe: { es: "maduro", ng: "nüre" },
  overripe: { es: "sobremaduro", ng: "nüre krübäte" },
};

/** Standing field-facing terms used across the weigh surface. */
export const WEIGH_TERMS = {
  weighIn: { es: "pesar", ng: "kä mike" },
  picker: { es: "recolector", ng: "ni ofo den" },
  plot: { es: "parcela", ng: "kä" },
  captured: { es: "registrado", ng: "ükaninte" },
  kg: { es: "kg", ng: "kg" },
  today: { es: "hoy", ng: "matare" },
  latas: { es: "latas", ng: "lata" },
} as const satisfies Record<string, BilingualLabel>;

/** Render "es · ngäbere" — both languages always shown on this field-only surface. */
export function bothLangs(label: BilingualLabel): string {
  return `${label.es} · ${label.ng}`;
}
