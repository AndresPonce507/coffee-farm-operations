import type { ProcessingBatch } from "@/lib/types";
import { LOT_CODES } from "@/lib/data/plots";

/**
 * Processing pipeline batches for Janson Coffee — wet mill → drying → green.
 *
 * Deterministic mock data (no Math.random / Date.now). Today for the mock set is
 * 2026-06-20, so every startedDate falls within 2026-05-20..2026-06-19.
 *
 * The pipeline advances cherry → fermentation → drying → parchment → milled → green;
 * currentKg shrinks as a batch advances (cherries lose mass through pulping, drying
 * and milling), settling near ~18% of cherriesKg by the green stage. progressPct and
 * moisturePct are tied to the stage:
 *   cherry ~8% · fermentation ~22% · drying ~55% · parchment ~72% · milled ~88% · green 100%
 *   moisture — drying 12–22% · parchment ~11.5% · green ~10.8% (earlier stages still wet).
 */
export const batches: ProcessingBatch[] = [
  {
    id: "b-602-geisha-anaerobic",
    lotCode: LOT_CODES[6], // JC-602
    variety: "Geisha",
    method: "Anaerobic",
    stage: "cherry",
    startedDate: "2026-06-19",
    cherriesKg: 620,
    currentKg: 620,
    moisturePct: 64.0,
    patio: "Patio 1",
    progressPct: 8,
  },
  {
    id: "b-611-pacamara-natural",
    lotCode: LOT_CODES[7], // JC-611
    variety: "Pacamara",
    method: "Natural",
    stage: "cherry",
    startedDate: "2026-06-18",
    cherriesKg: 1480,
    currentKg: 1480,
    moisturePct: 63.0,
    patio: "Patio 2",
    progressPct: 8,
  },
  {
    id: "b-596-geisha-washed",
    lotCode: LOT_CODES[5], // JC-596
    variety: "Geisha",
    method: "Washed",
    stage: "fermentation",
    startedDate: "2026-06-17",
    cherriesKg: 540,
    currentKg: 486,
    moisturePct: 58.0,
    patio: "Bed 3",
    progressPct: 22,
  },
  {
    id: "b-588-catuai-honey",
    lotCode: LOT_CODES[4], // JC-588
    variety: "Catuaí",
    method: "Honey",
    stage: "fermentation",
    startedDate: "2026-06-16",
    cherriesKg: 1760,
    currentKg: 1620,
    moisturePct: 57.0,
    patio: "Bed 4",
    progressPct: 22,
  },
  {
    id: "b-573-caturra-washed",
    lotCode: LOT_CODES[3], // JC-573
    variety: "Caturra",
    method: "Washed",
    stage: "drying",
    startedDate: "2026-06-11",
    cherriesKg: 2200,
    currentKg: 880,
    moisturePct: 18.5,
    patio: "Bed 5",
    progressPct: 55,
  },
  {
    id: "b-564-pacamara-natural",
    lotCode: LOT_CODES[2], // JC-564
    variety: "Pacamara",
    method: "Natural",
    stage: "drying",
    startedDate: "2026-06-08",
    cherriesKg: 1320,
    currentKg: 462,
    moisturePct: 21.0,
    patio: "Bed 6",
    progressPct: 55,
  },
  {
    id: "b-552-geisha-anaerobic",
    lotCode: LOT_CODES[1], // JC-552
    variety: "Geisha",
    method: "Anaerobic",
    stage: "drying",
    startedDate: "2026-06-06",
    cherriesKg: 480,
    currentKg: 132,
    moisturePct: 13.5,
    patio: "Bed 7",
    progressPct: 55,
  },
  {
    id: "b-541-typica-washed",
    lotCode: LOT_CODES[0], // JC-541
    variety: "Typica",
    method: "Washed",
    stage: "parchment",
    startedDate: "2026-06-02",
    cherriesKg: 1900,
    currentKg: 418,
    moisturePct: 11.5,
    patio: "Bed 8",
    progressPct: 72,
  },
  {
    id: "b-564-caturra-honey",
    lotCode: LOT_CODES[2], // JC-564
    variety: "Caturra",
    method: "Honey",
    stage: "milled",
    startedDate: "2026-05-27",
    cherriesKg: 1640,
    currentKg: 312,
    moisturePct: 11.0,
    patio: "Bed 9",
    progressPct: 88,
  },
  {
    id: "b-541-catuai-natural",
    lotCode: LOT_CODES[0], // JC-541
    variety: "Catuaí",
    method: "Natural",
    stage: "green",
    startedDate: "2026-05-21",
    cherriesKg: 2050,
    currentKg: 369,
    moisturePct: 10.8,
    patio: "Bed 2",
    progressPct: 100,
  },
  {
    id: "b-552-typica-washed",
    lotCode: LOT_CODES[1], // JC-552
    variety: "Typica",
    method: "Washed",
    stage: "green",
    startedDate: "2026-05-20",
    cherriesKg: 760,
    currentKg: 137,
    moisturePct: 10.8,
    patio: "Bed 1",
    progressPct: 100,
  },
];
