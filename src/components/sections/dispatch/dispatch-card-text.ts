/* ====================================================================== */
/* PURE, DB-free, React-free renderer for the morning dispatch card (P2-S5).*/
/*                                                                          */
/* Turns a `DispatchCard` into the shareable, WhatsApp-pasteable plain-text */
/* string the owner sends to the crew each morning ("Crew Norte → plots X, Y*/
/* ripe today, in pasada order"). Bilingual (es / ngäbere) when the crew    */
/* speaks ngäbere. Everything is derived from the card's own fields — there */
/* is NO Date.now(), NO randomness, NO I/O: same input → byte-identical out.*/
/*                                                                          */
/* 🚨 The ngäbere copy comes from labels.ts and is PLACEHOLDER text pending  */
/* native-speaker review (see labels.ts banner).                            */
/* ====================================================================== */

import type { DispatchCard, DispatchPlot } from "@/lib/types";

import {
  type BilingualLabel,
  DISPATCH_TERMS,
  RIPENESS_LABELS,
  bilingual,
  speaksNgabere,
} from "@/components/sections/dispatch/labels";

/** The farm name prefixed onto the native share-sheet title. */
const FARM_NAME = "Janson";

export interface RenderDispatchOptions {
  /** The crew's spoken languages — drives the bilingual ("es · ngäbere") copy. */
  languages?: string[];
}

/**
 * Render the full shareable plain-text dispatch card.
 *
 * Structure (one string, "\n"-separated, no leading/trailing blank lines):
 *   1. header   — greeting · crew name · date · "A cosechar hoy"
 *   2. plot rows — one "• <name> (<variety>, <altitude> msnm) — <band>" per plot,
 *                  in `card.plots` order (the port already sorted by pasada/ord),
 *                  with an optional per-plot kg target hint.
 *   3. footer   — the plot count ("N parcelas") or, when empty, a "no plots" line.
 *
 * Bilingual: when the crew speaks ngäbere, key terms render "es · ngäbere";
 * otherwise Spanish only. Deterministic — derived entirely from `card`.
 */
export function renderDispatchCardText(
  card: DispatchCard,
  opts: RenderDispatchOptions = {},
): string {
  const languages = opts.languages ?? [];
  const ng = speaksNgabere(languages);

  /** Render a bilingual term to "es" or "es · ngäbere" per the crew's languages. */
  const t = (label: BilingualLabel): string => bilingual(label, languages, label.es);

  const lines: string[] = [];

  // ── 1. header ──────────────────────────────────────────────────────────
  // "Buenos días — Norte — 2026-06-21". The "·" glyph is reserved exclusively
  // as the bilingual es·ngäbere pairing marker, so structural joins use "—".
  lines.push(`${t(DISPATCH_TERMS.goodMorning)} — ${card.crewName} — ${card.dispatchDate}`);
  // "A cosechar hoy" (the call to action)
  lines.push(t(DISPATCH_TERMS.pickToday));

  // a blank separator line keeps the WhatsApp paste readable
  lines.push("");

  // ── 2. plot rows (in the order the port already sorted) ────────────────
  if (card.plots.length === 0) {
    lines.push(t(DISPATCH_TERMS.noPlots));
  } else {
    for (const plot of card.plots) {
      lines.push(renderPlotLine(plot, t, ng));
    }
  }

  // ── 3. footer (plot count) ─────────────────────────────────────────────
  lines.push("");
  lines.push(renderFooter(card, t));

  return lines.join("\n");
}

/** One plot row: "• El Alto (Geisha, 1500 msnm) — muy maduro [meta 200 kg]". */
function renderPlotLine(
  plot: DispatchPlot,
  t: (label: BilingualLabel) => string,
  ng: boolean,
): string {
  const band = t(RIPENESS_LABELS[plot.ripenessTarget]);
  const masl = t(DISPATCH_TERMS.masl);

  let line = `• ${plot.plotName} (${plot.variety}, ${plot.altitudeMasl} ${masl}) — ${band}`;

  // optional per-plot kg target hint ("—" join; "·" stays the bilingual marker)
  if (plot.targetKg != null) {
    line += ` — ${t(DISPATCH_TERMS.target)} ${plot.targetKg} kg`;
  }

  // pasada-order hint on the first plot keeps the crew picking down the gradient
  if (plot.ord === 1 && ng) {
    // (kept terse so the line stays WhatsApp-friendly)
    line += ` (${t(DISPATCH_TERMS.pasadaOrder)})`;
  } else if (plot.ord === 1) {
    line += ` (${DISPATCH_TERMS.pasadaOrder.es})`;
  }

  return line;
}

/** Footer: "2 parcelas" / "1 parcela" — pluralised, bilingual via `t`. */
function renderFooter(
  card: DispatchCard,
  t: (label: BilingualLabel) => string,
): string {
  const count = card.plots.length;
  const noun = count === 1 ? t(DISPATCH_TERMS.plot) : t(DISPATCH_TERMS.plots);
  return `${count} ${noun}`;
}

/**
 * A short, single-line title for the device's native share sheet, e.g.
 * "Janson — Norte — 2026-06-21". Spanish-only (the share-sheet title is OS
 * chrome, not field copy). Deterministic.
 */
export function renderDispatchCardTitle(card: DispatchCard): string {
  return `${FARM_NAME} — ${card.crewName} — ${card.dispatchDate}`;
}
