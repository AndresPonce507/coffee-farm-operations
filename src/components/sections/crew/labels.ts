/* ====================================================================== */
/* Bilingual (es / ngäbere) field-facing labels for the crew surface.      */
/*                                                                          */
/* 🚨 PLACEHOLDER TRANSLATIONS — the ngäbere strings below are best-effort  */
/* PLACEHOLDERS and MUST be reviewed by a native Ngäbe-Buglé speaker before */
/* this reaches the field. They exist so the bilingual affordance renders   */
/* today (many crew members on Janson speak ngäbere, not Spanish, in the    */
/* field); they are NOT authoritative. Do not ship to production copy as-is. */
/*                                                                          */
/* Each entry pairs the Spanish (es) farm-office term with its ngäbere       */
/* counterpart. Field-facing strings show "es · ngäbere" when the member    */
/* speaks ngäbere (driven by the `languages` array on the roster row).      */
/* ====================================================================== */

/** A single bilingual term: Spanish + its (placeholder) ngäbere rendering. */
export interface BilingualLabel {
  /** Spanish — the farm-office canonical term. */
  es: string;
  /** Ngäbere — PLACEHOLDER, pending native-speaker review. */
  ng: string;
}

/** Attendance states, by the `attendance` field on the roster row. */
export const ATTENDANCE_LABELS: Record<string, BilingualLabel> = {
  present: { es: "presente", ng: "nügai" },
  "rest-day": { es: "día de descanso", ng: "köbö jadüäre" },
  absent: { es: "ausente", ng: "ñaka nüke" },
};

/** Attendance-event kinds for the append-only timeline. */
export const EVENT_KIND_LABELS: Record<string, BilingualLabel> = {
  "clock-in": { es: "entrada", ng: "kite sribire" },
  "clock-out": { es: "salida", ng: " neme sribire" },
  "rest-day": { es: "día de descanso", ng: "köbö jadüäre" },
  absent: { es: "ausencia", ng: "ñaka nüke" },
};

/** Standing field-facing terms used across the crew surface. */
export const TERMS = {
  crew: { es: "cuadrilla", ng: "nitre sribikä" },
  present: { es: "presente", ng: "nügai" },
  rehire: { es: "recontratar", ng: "mike sribire bobukäre" },
  welcomeBack: { es: "bienvenido de nuevo", ng: "köböre kwin" },
} as const satisfies Record<string, BilingualLabel>;

/**
 * Render a bilingual term as "es · ngäbere" when the member speaks ngäbere,
 * otherwise just the Spanish. `languages` is the roster row's array.
 */
export function bilingual(
  label: BilingualLabel | undefined,
  languages: string[],
  fallback: string,
): string {
  if (!label) return fallback;
  const speaksNgabere = languages.some((l) => /ng(ä|a)bere/i.test(l));
  return speaksNgabere ? `${label.es} · ${label.ng}` : label.es;
}

/** True when this member speaks ngäbere (drives the language chip + bilingual text). */
export function speaksNgabere(languages: string[]): boolean {
  return languages.some((l) => /ng(ä|a)bere/i.test(l));
}
