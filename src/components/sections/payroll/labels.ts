/* ====================================================================== */
/* Bilingual (es / ngäbere) field-facing labels for the payroll surface.   */
/*                                                                          */
/* 🚨 PLACEHOLDER TRANSLATIONS — the ngäbere strings below are best-effort  */
/* PLACEHOLDERS and MUST be reviewed by a native Ngäbe-Buglé speaker before */
/* this reaches the field. They exist so the bilingual affordance renders   */
/* today (many crew members on Janson speak ngäbere, not Spanish, in the    */
/* field); they are NOT authoritative. Do not ship to production copy as-is. */
/*                                                                          */
/* The payslip is the most consequential bilingual surface — a worker must  */
/* be able to read what they earned, what was withheld, and what they take  */
/* home in their own language. Field-facing strings show "es · ngäbere"     */
/* when the worker speaks ngäbere (driven by the `languages` array).        */
/* ====================================================================== */

/** A single bilingual term: Spanish + its (placeholder) ngäbere rendering. */
export interface BilingualLabel {
  /** Spanish — the farm-office canonical term. */
  es: string;
  /** Ngäbere — PLACEHOLDER, pending native-speaker review. */
  ng: string;
}

/**
 * Standing payslip terms. Keys are the payslip's line items + chrome.
 * `makeWhole` carries the dignity copy: the top-up to the legal minimum.
 */
export const PAYSLIP_TERMS = {
  payslip: { es: "comprobante de pago", ng: "ngwian kärä tärä" },
  worker: { es: "trabajador", ng: "ni sribikä" },
  period: { es: "período", ng: "köbö" },
  pieceRate: { es: "por obra", ng: "sribi köböire" },
  hourly: { es: "por hora", ng: "ora köböire" },
  makeWhole: { es: "ajuste al mínimo legal", ng: "ükaninte köböire ñakare" },
  gross: { es: "bruto", ng: "ngwian jökrä" },
  deductions: { es: "deducciones", ng: "ngwian denankä" },
  css: { es: "CSS (seguro social)", ng: "CSS ngäbäre" },
  seguroEducativo: { es: "seguro educativo", ng: "skial ngäbäre" },
  decimo: { es: "décimo (provisión)", ng: "décimo ükaninte" },
  net: { es: "neto", ng: "ngwian käne" },
  takeHome: { es: "a recibir", ng: "ngwian ja kräke" },
  scanForDetails: { es: "escanee para ver el detalle", ng: "mike ñäre detalle kräke" },
} as const satisfies Record<string, BilingualLabel>;

/** Render a payslip term as "es · ngäbere" when `showNg`, otherwise just Spanish. */
export function bilingual(label: BilingualLabel, showNg: boolean): string {
  return showNg ? `${label.es} · ${label.ng}` : label.es;
}

/** True when this worker speaks ngäbere (drives the bilingual payslip render). */
export function speaksNgabere(languages: string[]): boolean {
  return languages.some((l) => /ng(ä|a)bere/i.test(l));
}
