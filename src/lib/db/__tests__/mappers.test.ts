import { describe, expect, it } from "vitest";

import { mapPlot, type PlotRow } from "@/lib/db/plots";
import { mapWorker, type WorkerRow } from "@/lib/db/workers";
import { mapHarvest, type HarvestRow } from "@/lib/db/harvests";
import { mapBatch, type BatchRow } from "@/lib/db/processing";
import { mapTask, type TaskRow } from "@/lib/db/tasks";
import { mapActivity, type ActivityRow } from "@/lib/db/activity";
import { mapWeather, type WeatherRow } from "@/lib/db/weather";
import {
  mapSeason,
  mapTrend,
  mapVarietyShare,
  type SeasonRow,
  type TrendRow,
  type VarietyShareRow,
} from "@/lib/db/trends";

/**
 * These mappers are the seam between PostgREST rows (snake_case, numerics that
 * may arrive as strings) and the app's camelCase domain types. The tests pin:
 *   1. every field is renamed correctly (a transposed field would fail),
 *   2. numeric columns are coerced to real numbers even when given as strings,
 *   3. nullable FKs survive as null.
 */

describe("mapPlot", () => {
  const row: PlotRow = {
    id: "p-tizingal-alto",
    ord: 0,
    name: "Tizingal Alto",
    block: "Block A",
    variety: "Geisha",
    area_ha: "4.2", // PostgREST may serialize numeric as a string
    altitude_masl: 1690,
    trees: 14800,
    shade_pct: 55,
    established_year: 2014,
    status: "healthy",
    last_inspected: "2026-06-18",
    expected_yield_kg: "18600",
    harvested_kg: 12120,
  };

  it("renames snake_case → camelCase and coerces numerics", () => {
    expect(mapPlot(row)).toEqual({
      id: "p-tizingal-alto",
      name: "Tizingal Alto",
      block: "Block A",
      variety: "Geisha",
      areaHa: 4.2,
      altitudeMasl: 1690,
      trees: 14800,
      shadePct: 55,
      establishedYear: 2014,
      status: "healthy",
      lastInspected: "2026-06-18",
      expectedYieldKg: 18600,
      harvestedKg: 12120,
    });
  });

  it("does not leak the ord column into the domain object", () => {
    expect(mapPlot(row)).not.toHaveProperty("ord");
  });
});

describe("mapWorker", () => {
  it("maps a picker row", () => {
    const row: WorkerRow = {
      id: "w-06",
      name: "Lucía Morales",
      role: "Picker",
      daily_rate_usd: "22",
      attendance: "present",
      started_year: 2019,
      phone: "+507 6655-2210",
      today_kg: "88",
      crew: "Crew Tizingal",
    };
    expect(mapWorker(row)).toEqual({
      id: "w-06",
      name: "Lucía Morales",
      role: "Picker",
      dailyRateUsd: 22,
      attendance: "present",
      startedYear: 2019,
      phone: "+507 6655-2210",
      todayKg: 88,
      crew: "Crew Tizingal",
    });
  });
});

describe("mapHarvest", () => {
  it("carries the re-joined plot_name, picker, and worker_id→workerId", () => {
    const row: HarvestRow = {
      id: "h-0620-01",
      date: "2026-06-20",
      plot_id: "p-tizingal-alto",
      plot_name: "Tizingal Alto",
      picker: "Lucía Morales",
      worker_id: "w-lucia-morales",
      cherries_kg: 88,
      ripeness_pct: 96,
      brix_avg: "23.4",
      lot_code: "JC-564",
    };
    expect(mapHarvest(row)).toEqual({
      id: "h-0620-01",
      date: "2026-06-20",
      plotId: "p-tizingal-alto",
      plotName: "Tizingal Alto",
      picker: "Lucía Morales",
      workerId: "w-lucia-morales",
      cherriesKg: 88,
      ripenessPct: 96,
      brixAvg: 23.4,
      lotCode: "JC-564",
    });
  });
});

describe("mapBatch", () => {
  it("maps a drying batch", () => {
    const row: BatchRow = {
      id: "b-552-geisha-anaerobic",
      lot_code: "JC-552",
      variety: "Geisha",
      method: "Anaerobic",
      stage: "drying",
      started_date: "2026-06-06",
      cherries_kg: 480,
      current_kg: 132,
      moisture_pct: "13.5",
      patio: "Bed 7",
      progress_pct: 55,
    };
    expect(mapBatch(row)).toEqual({
      id: "b-552-geisha-anaerobic",
      lotCode: "JC-552",
      variety: "Geisha",
      method: "Anaerobic",
      stage: "drying",
      startedDate: "2026-06-06",
      cherriesKg: 480,
      currentKg: 132,
      moisturePct: 13.5,
      patio: "Bed 7",
      progressPct: 55,
    });
  });
});

describe("mapTask", () => {
  it("maps a plot-scoped task and forwards worker_id→workerId", () => {
    const row: TaskRow = {
      id: "t-01",
      title: "Scout for broca (berry borer)",
      category: "Pest Control",
      plot_id: "p-paso-ancho",
      plot_name: "Paso Ancho",
      assignee: "Janette Janson",
      worker_id: "w-janette-janson",
      due: "2026-06-16",
      status: "in-progress",
      priority: "high",
    };
    expect(mapTask(row)).toEqual({
      id: "t-01",
      title: "Scout for broca (berry borer)",
      category: "Pest Control",
      plotId: "p-paso-ancho",
      plotName: "Paso Ancho",
      assignee: "Janette Janson",
      workerId: "w-janette-janson",
      due: "2026-06-16",
      status: "in-progress",
      priority: "high",
    });
  });

  it("preserves null plot and null worker_id for farm-wide unassigned work", () => {
    const row: TaskRow = {
      id: "t-02",
      title: "Repair drying bed mesh on raised beds 4–7",
      category: "Soil",
      plot_id: null,
      plot_name: null,
      assignee: "Néstor Gómez",
      worker_id: null,
      due: "2026-06-17",
      status: "blocked",
      priority: "high",
    };
    const mapped = mapTask(row);
    expect(mapped.plotId).toBeNull();
    expect(mapped.plotName).toBeNull();
    expect(mapped.workerId).toBeNull();
  });
});

describe("mapActivity", () => {
  it("maps a feed item", () => {
    const row: ActivityRow = {
      id: "act-01",
      at: "2026-06-20",
      kind: "harvest",
      text: "Talamanca delivered 84 kg cherries — Rosa Quintero, lot JC-552",
    };
    expect(mapActivity(row)).toEqual({
      id: "act-01",
      at: "2026-06-20",
      kind: "harvest",
      text: "Talamanca delivered 84 kg cherries — Rosa Quintero, lot JC-552",
    });
  });
});

describe("mapWeather", () => {
  it("drops sort_order and coerces numerics", () => {
    const row: WeatherRow = {
      sort_order: 0,
      day: "Today",
      hi: 22,
      lo: 14,
      rain_pct: 65,
      icon: "rain",
    };
    expect(mapWeather(row)).toEqual({
      day: "Today",
      hi: 22,
      lo: 14,
      rainPct: 65,
      icon: "rain",
    });
  });
});

describe("trends mappers", () => {
  it("mapTrend coerces value", () => {
    const row: TrendRow = { sort_order: 0, label: "Jun 7", value: "382" };
    expect(mapTrend(row)).toEqual({ label: "Jun 7", value: 382 });
  });

  it("mapVarietyShare coerces kg", () => {
    const row: VarietyShareRow = { variety: "Caturra", kg: "36700" };
    expect(mapVarietyShare(row)).toEqual({ variety: "Caturra", kg: 36700 });
  });

  it("mapSeason maps the singleton", () => {
    const row: SeasonRow = {
      id: 1,
      target_kg: 190000,
      harvested_kg: 122240,
      today_kg: 642,
      ytd_revenue_usd: "486500",
    };
    expect(mapSeason(row)).toEqual({
      targetKg: 190000,
      harvestedKg: 122240,
      todayKg: 642,
      ytdRevenueUsd: 486500,
    });
  });
});
