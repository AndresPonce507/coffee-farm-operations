import type { Harvest } from "@/lib/types";
import { plots, LOT_CODES } from "@/lib/data/plots";
import { pickers } from "@/lib/data/workers";

/**
 * Daily picking records for Janson Coffee, Volcán — current harvest window.
 *
 * Deterministic mock data (no random, no Date.now). Every record references a
 * real plot (id + name) from {@link plots} and a real picker name from
 * {@link pickers}. Geisha lots (Tizingal Alto, Barú Vista, Las Lagunas) trend
 * toward the higher end of the Brix range, as they do on the farm.
 *
 * Today is 2026-06-20; the eight records dated that day total ~644 kg.
 */

/** Picker names, resolved from the canonical workforce so they never drift. */
const PICKER = Object.fromEntries(pickers.map((p) => [p.id, p.name])) as Record<
  string,
  string
>;


/** Plot name lookup, resolved from the canonical plots anchor. */
const PLOT_NAME = Object.fromEntries(plots.map((p) => [p.id, p.name])) as Record<
  string,
  string
>;

export const harvests: Harvest[] = [
  /* ---------------- 2026-06-20 — today (~644 kg across 8 lots) ---------------- */
  {
    id: "h-0620-01",
    date: "2026-06-20",
    plotId: "p-tizingal-alto",
    plotName: PLOT_NAME["p-tizingal-alto"],
    picker: PICKER["w-06"], // Lucía Morales
    workerId: "w-06",
    cherriesKg: 88,
    ripenessPct: 96,
    brixAvg: 23.4,
    lotCode: LOT_CODES[2], // JC-564
  },
  {
    id: "h-0620-02",
    date: "2026-06-20",
    plotId: "p-tizingal-alto",
    plotName: PLOT_NAME["p-tizingal-alto"],
    picker: PICKER["w-13"], // Iris Castillo
    workerId: "w-13",
    cherriesKg: 71,
    ripenessPct: 94,
    brixAvg: 22.8,
    lotCode: LOT_CODES[2], // JC-564
  },
  {
    id: "h-0620-03",
    date: "2026-06-20",
    plotId: "p-las-lagunas",
    plotName: PLOT_NAME["p-las-lagunas"],
    picker: PICKER["w-08"], // Ana Serrano
    workerId: "w-08",
    cherriesKg: 76,
    ripenessPct: 97,
    brixAvg: 23.9,
    lotCode: LOT_CODES[6], // JC-602
  },
  {
    id: "h-0620-04",
    date: "2026-06-20",
    plotId: "p-talamanca",
    plotName: PLOT_NAME["p-talamanca"],
    picker: PICKER["w-03"], // Eduardo Pérez
    workerId: "w-03",
    cherriesKg: 92,
    ripenessPct: 90,
    brixAvg: 19.6,
    lotCode: LOT_CODES[1], // JC-552
  },
  {
    id: "h-0620-05",
    date: "2026-06-20",
    plotId: "p-talamanca",
    plotName: PLOT_NAME["p-talamanca"],
    picker: PICKER["w-04"], // Rosa Quintero
    workerId: "w-04",
    cherriesKg: 84,
    ripenessPct: 91,
    brixAvg: 19.9,
    lotCode: LOT_CODES[1], // JC-552
  },
  {
    id: "h-0620-06",
    date: "2026-06-20",
    plotId: "p-nueva-suiza",
    plotName: PLOT_NAME["p-nueva-suiza"],
    picker: PICKER["w-14"], // Félix Rodríguez
    workerId: "w-14",
    cherriesKg: 79,
    ripenessPct: 88,
    brixAvg: 20.4,
    lotCode: LOT_CODES[3], // JC-573
  },
  {
    id: "h-0620-07",
    date: "2026-06-20",
    plotId: "p-baru-vista",
    plotName: PLOT_NAME["p-baru-vista"],
    picker: PICKER["w-05"], // Tomás Atencio
    workerId: "w-05",
    cherriesKg: 64,
    ripenessPct: 93,
    brixAvg: 22.6,
    lotCode: LOT_CODES[0], // JC-541
  },
  {
    id: "h-0620-08",
    date: "2026-06-20",
    plotId: "p-bambito",
    plotName: PLOT_NAME["p-bambito"],
    picker: PICKER["w-09"], // Pedro Caballero
    workerId: "w-09",
    cherriesKg: 90,
    ripenessPct: 89,
    brixAvg: 19.2,
    lotCode: LOT_CODES[5], // JC-596
  },

  /* ---------------- 2026-06-19 ---------------- */
  {
    id: "h-0619-01",
    date: "2026-06-19",
    plotId: "p-tizingal-alto",
    plotName: PLOT_NAME["p-tizingal-alto"],
    picker: PICKER["w-06"], // Lucía Morales
    workerId: "w-06",
    cherriesKg: 82,
    ripenessPct: 95,
    brixAvg: 23.1,
    lotCode: LOT_CODES[2], // JC-564
  },
  {
    id: "h-0619-02",
    date: "2026-06-19",
    plotId: "p-las-lagunas",
    plotName: PLOT_NAME["p-las-lagunas"],
    picker: PICKER["w-13"], // Iris Castillo
    workerId: "w-13",
    cherriesKg: 68,
    ripenessPct: 98,
    brixAvg: 23.7,
    lotCode: LOT_CODES[6], // JC-602
  },
  {
    id: "h-0619-03",
    date: "2026-06-19",
    plotId: "p-talamanca",
    plotName: PLOT_NAME["p-talamanca"],
    picker: PICKER["w-03"], // Eduardo Pérez
    workerId: "w-03",
    cherriesKg: 96,
    ripenessPct: 90,
    brixAvg: 19.4,
    lotCode: LOT_CODES[1], // JC-552
  },
  {
    id: "h-0619-04",
    date: "2026-06-19",
    plotId: "p-palmira",
    plotName: PLOT_NAME["p-palmira"],
    picker: PICKER["w-14"], // Félix Rodríguez
    workerId: "w-14",
    cherriesKg: 87,
    ripenessPct: 87,
    brixAvg: 20.1,
    lotCode: LOT_CODES[7], // JC-611
  },

  /* ---------------- 2026-06-18 ---------------- */
  {
    id: "h-0618-01",
    date: "2026-06-18",
    plotId: "p-baru-vista",
    plotName: PLOT_NAME["p-baru-vista"],
    picker: PICKER["w-05"], // Tomás Atencio
    workerId: "w-05",
    cherriesKg: 73,
    ripenessPct: 92,
    brixAvg: 22.3,
    lotCode: LOT_CODES[0], // JC-541
  },
  {
    id: "h-0618-02",
    date: "2026-06-18",
    plotId: "p-tizingal-alto",
    plotName: PLOT_NAME["p-tizingal-alto"],
    picker: PICKER["w-08"], // Ana Serrano
    workerId: "w-08",
    cherriesKg: 79,
    ripenessPct: 94,
    brixAvg: 22.9,
    lotCode: LOT_CODES[2], // JC-564
  },
  {
    id: "h-0618-03",
    date: "2026-06-18",
    plotId: "p-nueva-suiza",
    plotName: PLOT_NAME["p-nueva-suiza"],
    picker: PICKER["w-04"], // Rosa Quintero
    workerId: "w-04",
    cherriesKg: 85,
    ripenessPct: 89,
    brixAvg: 20.6,
    lotCode: LOT_CODES[3], // JC-573
  },
  {
    id: "h-0618-04",
    date: "2026-06-18",
    plotId: "p-bambito",
    plotName: PLOT_NAME["p-bambito"],
    picker: PICKER["w-09"], // Pedro Caballero
    workerId: "w-09",
    cherriesKg: 94,
    ripenessPct: 88,
    brixAvg: 19.0,
    lotCode: LOT_CODES[5], // JC-596
  },

  /* ---------------- 2026-06-17 ---------------- */
  {
    id: "h-0617-01",
    date: "2026-06-17",
    plotId: "p-talamanca",
    plotName: PLOT_NAME["p-talamanca"],
    picker: PICKER["w-03"], // Eduardo Pérez
    workerId: "w-03",
    cherriesKg: 101,
    ripenessPct: 91,
    brixAvg: 19.7,
    lotCode: LOT_CODES[1], // JC-552
  },
  {
    id: "h-0617-02",
    date: "2026-06-17",
    plotId: "p-las-lagunas",
    plotName: PLOT_NAME["p-las-lagunas"],
    picker: PICKER["w-06"], // Lucía Morales
    workerId: "w-06",
    cherriesKg: 62,
    ripenessPct: 97,
    brixAvg: 23.5,
    lotCode: LOT_CODES[6], // JC-602
  },
  {
    id: "h-0617-03",
    date: "2026-06-17",
    plotId: "p-rio-sereno",
    plotName: PLOT_NAME["p-rio-sereno"],
    picker: PICKER["w-13"], // Iris Castillo
    workerId: "w-13",
    cherriesKg: 70,
    ripenessPct: 86,
    brixAvg: 21.2,
    lotCode: LOT_CODES[4], // JC-588
  },

  /* ---------------- 2026-06-16 ---------------- */
  {
    id: "h-0616-01",
    date: "2026-06-16",
    plotId: "p-baru-vista",
    plotName: PLOT_NAME["p-baru-vista"],
    picker: PICKER["w-05"], // Tomás Atencio
    workerId: "w-05",
    cherriesKg: 75,
    ripenessPct: 93,
    brixAvg: 22.5,
    lotCode: LOT_CODES[0], // JC-541
  },
  {
    id: "h-0616-02",
    date: "2026-06-16",
    plotId: "p-palmira",
    plotName: PLOT_NAME["p-palmira"],
    picker: PICKER["w-14"], // Félix Rodríguez
    workerId: "w-14",
    cherriesKg: 90,
    ripenessPct: 85,
    brixAvg: 19.8,
    lotCode: LOT_CODES[7], // JC-611
  },
  {
    id: "h-0616-03",
    date: "2026-06-16",
    plotId: "p-nueva-suiza",
    plotName: PLOT_NAME["p-nueva-suiza"],
    picker: PICKER["w-04"], // Rosa Quintero
    workerId: "w-04",
    cherriesKg: 83,
    ripenessPct: 90,
    brixAvg: 20.3,
    lotCode: LOT_CODES[3], // JC-573
  },

  /* ---------------- 2026-06-15 ---------------- */
  {
    id: "h-0615-01",
    date: "2026-06-15",
    plotId: "p-cuesta-piedra",
    plotName: PLOT_NAME["p-cuesta-piedra"],
    picker: PICKER["w-09"], // Pedro Caballero
    workerId: "w-09",
    cherriesKg: 77,
    ripenessPct: 84,
    brixAvg: 20.0,
    lotCode: LOT_CODES[3], // JC-573
  },
  {
    id: "h-0615-02",
    date: "2026-06-15",
    plotId: "p-tizingal-alto",
    plotName: PLOT_NAME["p-tizingal-alto"],
    picker: PICKER["w-08"], // Ana Serrano
    workerId: "w-08",
    cherriesKg: 80,
    ripenessPct: 95,
    brixAvg: 23.0,
    lotCode: LOT_CODES[2], // JC-564
  },
  {
    id: "h-0615-03",
    date: "2026-06-15",
    plotId: "p-bambito",
    plotName: PLOT_NAME["p-bambito"],
    picker: PICKER["w-03"], // Eduardo Pérez
    workerId: "w-03",
    cherriesKg: 98,
    ripenessPct: 89,
    brixAvg: 19.3,
    lotCode: LOT_CODES[5], // JC-596
  },

  /* ---------------- 2026-06-14 ---------------- */
  {
    id: "h-0614-01",
    date: "2026-06-14",
    plotId: "p-talamanca",
    plotName: PLOT_NAME["p-talamanca"],
    picker: PICKER["w-04"], // Rosa Quintero
    workerId: "w-04",
    cherriesKg: 89,
    ripenessPct: 90,
    brixAvg: 19.5,
    lotCode: LOT_CODES[1], // JC-552
  },
  {
    id: "h-0614-02",
    date: "2026-06-14",
    plotId: "p-las-lagunas",
    plotName: PLOT_NAME["p-las-lagunas"],
    picker: PICKER["w-06"], // Lucía Morales
    workerId: "w-06",
    cherriesKg: 66,
    ripenessPct: 96,
    brixAvg: 23.6,
    lotCode: LOT_CODES[6], // JC-602
  },
  {
    id: "h-0614-03",
    date: "2026-06-14",
    plotId: "p-paso-ancho",
    plotName: PLOT_NAME["p-paso-ancho"],
    picker: PICKER["w-05"], // Tomás Atencio
    workerId: "w-05",
    cherriesKg: 58,
    ripenessPct: 82,
    brixAvg: 21.4,
    lotCode: LOT_CODES[4], // JC-588
  },

  /* ---------------- 2026-06-13 ---------------- */
  {
    id: "h-0613-01",
    date: "2026-06-13",
    plotId: "p-baru-vista",
    plotName: PLOT_NAME["p-baru-vista"],
    picker: PICKER["w-13"], // Iris Castillo
    workerId: "w-13",
    cherriesKg: 72,
    ripenessPct: 92,
    brixAvg: 22.2,
    lotCode: LOT_CODES[0], // JC-541
  },
  {
    id: "h-0613-02",
    date: "2026-06-13",
    plotId: "p-palmira",
    plotName: PLOT_NAME["p-palmira"],
    picker: PICKER["w-14"], // Félix Rodríguez
    workerId: "w-14",
    cherriesKg: 86,
    ripenessPct: 86,
    brixAvg: 19.9,
    lotCode: LOT_CODES[7], // JC-611
  },
  {
    id: "h-0613-03",
    date: "2026-06-13",
    plotId: "p-rio-sereno",
    plotName: PLOT_NAME["p-rio-sereno"],
    picker: PICKER["w-08"], // Ana Serrano
    workerId: "w-08",
    cherriesKg: 69,
    ripenessPct: 85,
    brixAvg: 21.0,
    lotCode: LOT_CODES[4], // JC-588
  },
];
