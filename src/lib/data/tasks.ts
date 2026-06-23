import type { FarmTask } from "@/lib/types";
import { plots } from "@/lib/data/plots";
import { workers } from "@/lib/data/workers";

/**
 * Canonical agronomy task board for Janson Coffee, Volcán.
 * Deterministic mock data — references real plots (by id + name) and real worker
 * names as assignees. "Today" for status math across the app is 2026-06-20, so
 * three tasks with a due date before that are genuinely OVERDUE.
 *
 * plotId/plotName are resolved from the anchor `plots` array (a few left null for
 * farm-wide work); assignees are resolved from the anchor `workers` array so a
 * rename in either anchor never drifts this file.
 */

const plotName = (id: string): string => {
  const plot = plots.find((p) => p.id === id);
  if (!plot) throw new Error(`tasks.ts: unknown plotId "${id}"`);
  return plot.name;
};

const worker = (id: string): string => {
  const found = workers.find((w) => w.id === id);
  if (!found) throw new Error(`tasks.ts: unknown workerId "${id}"`);
  return found.name;
};

// Assignee shortcuts — favor Agronomist / Supervisor / Mill Operator.
const JANETTE = worker("w-02"); // Agronomist
const MIGUEL = worker("w-01"); // Supervisor
const NESTOR = worker("w-10"); // Mill Operator
const YARISEL = worker("w-11"); // Mill Operator
const RAUL = worker("w-12"); // Driver

export const tasks: FarmTask[] = [
  // ---- OVERDUE (due before 2026-06-20) ----
  {
    id: "t-01",
    title: "Scout for broca (berry borer)",
    category: "Pest Control",
    plotId: "p-paso-ancho",
    plotName: plotName("p-paso-ancho"),
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-16",
    status: "in-progress",
    priority: "high",
  },
  {
    id: "t-02",
    title: "Repair drying bed mesh on raised beds 4–7",
    category: "Soil",
    plotId: null,
    plotName: null,
    assignee: NESTOR,
    workerId: "w-10",
    due: "2026-06-17",
    status: "blocked",
    priority: "high",
  },
  {
    id: "t-03",
    title: "Weed and mulch tree rows after early rains",
    category: "Weeding",
    plotId: "p-cuesta-piedra",
    plotName: plotName("p-cuesta-piedra"),
    assignee: MIGUEL,
    workerId: "w-01",
    due: "2026-06-19",
    status: "todo",
    priority: "medium",
  },

  // ---- DUE TODAY / THIS WEEK ----
  {
    id: "t-04",
    title: "Apply organic compost to young Geisha trees",
    category: "Fertilizing",
    plotId: "p-las-lagunas",
    plotName: plotName("p-las-lagunas"),
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-20",
    status: "todo",
    priority: "medium",
  },
  {
    id: "t-05",
    title: "Calibrate pulper before next wet-mill run",
    category: "Soil",
    plotId: null,
    plotName: null,
    assignee: YARISEL,
    workerId: "w-11",
    due: "2026-06-21",
    status: "in-progress",
    priority: "high",
  },
  {
    id: "t-06",
    title: "Renovate shade canopy — thin overgrown guabo",
    category: "Pruning",
    plotId: "p-talamanca",
    plotName: plotName("p-talamanca"),
    assignee: MIGUEL,
    workerId: "w-01",
    due: "2026-06-22",
    status: "todo",
    priority: "medium",
  },
  {
    id: "t-07",
    title: "Selective pruning of bourbon-form Caturra",
    category: "Pruning",
    plotId: "p-bambito",
    plotName: plotName("p-bambito"),
    assignee: MIGUEL,
    workerId: "w-01",
    due: "2026-06-23",
    status: "todo",
    priority: "low",
  },
  {
    id: "t-08",
    title: "Soil pH sampling across Block B",
    category: "Soil",
    plotId: "p-nueva-suiza",
    plotName: plotName("p-nueva-suiza"),
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-24",
    status: "todo",
    priority: "medium",
  },
  {
    id: "t-09",
    title: "Flush and inspect drip irrigation lines",
    category: "Irrigation",
    plotId: "p-palmira",
    plotName: plotName("p-palmira"),
    assignee: RAUL,
    workerId: "w-12",
    due: "2026-06-25",
    status: "todo",
    priority: "low",
  },
  {
    id: "t-10",
    title: "Foliar feed with seaweed extract post-bloom",
    category: "Fertilizing",
    plotId: "p-baru-vista",
    plotName: plotName("p-baru-vista"),
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-26",
    status: "todo",
    priority: "medium",
  },
  {
    id: "t-11",
    title: "Stump and re-establish frost-damaged rows",
    category: "Planting",
    plotId: "p-rio-sereno",
    plotName: plotName("p-rio-sereno"),
    assignee: MIGUEL,
    workerId: "w-01",
    due: "2026-06-27",
    status: "todo",
    priority: "low",
  },
  {
    id: "t-12",
    title: "Transplant Geisha seedlings from the nursery",
    category: "Planting",
    plotId: "p-tizingal-alto",
    plotName: plotName("p-tizingal-alto"),
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-28",
    status: "todo",
    priority: "medium",
  },
  {
    id: "t-13",
    title: "Hang broca alcohol-and-water traps farm-wide",
    category: "Pest Control",
    plotId: null,
    plotName: null,
    assignee: JANETTE,
    workerId: "w-02",
    due: "2026-06-29",
    status: "todo",
    priority: "high",
  },
  {
    id: "t-14",
    title: "Clear and grade the Block C access road",
    category: "Weeding",
    plotId: "p-paso-ancho",
    plotName: plotName("p-paso-ancho"),
    assignee: RAUL,
    workerId: "w-12",
    due: "2026-06-30",
    status: "todo",
    priority: "low",
  },
];
