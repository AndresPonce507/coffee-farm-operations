import type { ActivityItem } from "@/lib/types";

/**
 * Recent operations feed for Janson Coffee, Volcán — the "what just happened"
 * stream that powers the dashboard activity panel.
 *
 * Deterministic mock data (no Math.random / Date.now). "Today" for the mock set is
 * 2026-06-20, so every item is dated 2026-06-19 or 2026-06-20 and the list is
 * ordered newest-first. Each line references real anchors that already exist in the
 * canonical data: plot names (plots.ts), picker / worker names (workers.ts),
 * traceability lot codes + drying beds / patios (processing.ts), and agronomy work
 * (tasks.ts) — so nothing here drifts from the rest of the app.
 */
export const activity: ActivityItem[] = [
  {
    id: "act-01",
    at: "2026-06-20",
    kind: "harvest",
    text: "Talamanca delivered 84 kg cherries — Rosa Quintero, lot JC-552",
  },
  {
    id: "act-02",
    at: "2026-06-20",
    kind: "harvest",
    text: "Barú Vista delivered 64 kg cherries — Tomás Atencio, lot JC-541",
  },
  {
    id: "act-03",
    at: "2026-06-20",
    kind: "labor",
    text: "Crew Norte clocked in — 644 kg picked across 8 lots today",
  },
  {
    id: "act-04",
    at: "2026-06-20",
    kind: "processing",
    text: "Lot JC-602 Geisha started anaerobic ferment — Néstor Gómez (Patio 1)",
  },
  {
    id: "act-05",
    at: "2026-06-20",
    kind: "task",
    text: "Shade pruning started on Talamanca — Miguel Janson thinning guabo canopy",
  },
  {
    id: "act-06",
    at: "2026-06-19",
    kind: "processing",
    text: "Lot JC-552 Geisha moved to drying (Bed 7) — moisture at 13.5%",
  },
  {
    id: "act-07",
    at: "2026-06-19",
    kind: "shipment",
    text: "Green export lot JC-541 staged for shipment — Raúl Santamaría loading",
  },
  {
    id: "act-08",
    at: "2026-06-19",
    kind: "harvest",
    text: "Las Lagunas delivered 68 kg cherries — Iris Castillo, lot JC-602",
  },
  {
    id: "act-09",
    at: "2026-06-19",
    kind: "task",
    text: "Broca (berry borer) scouting underway on Paso Ancho — Janette Janson",
  },
];
