import { describe, expect, it, vi } from "vitest";

import type { Plot, Worker } from "@/lib/types";

vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(
    async (): Promise<Worker[]> => [
      {
        id: "w-lupita",
        name: "Lupita González",
        role: "Picker",
        dailyRateUsd: 18,
        attendance: "present",
        startedYear: 2019,
        phone: "+507 6000-0000",
        todayKg: 64,
        crew: "Cuadrilla A",
      },
    ],
  ),
}));

import { getPickerIdByName, getPlotYield } from "@/lib/db/dossier/plot";

const plot: Plot = {
  id: "p-tizingal-alto",
  name: "Tizingal Alto",
  block: "Bloque A",
  variety: "Geisha",
  areaHa: 2.4,
  altitudeMasl: 1650,
  trees: 4200,
  shadePct: 35,
  establishedYear: 2014,
  status: "watch",
  lastInspected: "2026-06-10",
  expectedYieldKg: 9000,
  harvestedKg: 5400,
};

describe("getPlotYield", () => {
  it("computes harvested ÷ expected as a percentage", () => {
    expect(getPlotYield(plot).pct).toBeCloseTo(60);
  });

  it("returns a null pct (never a fabricated 0%) when the target is undeclared", () => {
    expect(getPlotYield({ ...plot, expectedYieldKg: 0 }).pct).toBeNull();
  });
});

describe("getPickerIdByName", () => {
  it("maps a worker display name → its stable id", async () => {
    const map = await getPickerIdByName();
    expect(map["Lupita González"]).toBe("w-lupita");
  });

  it("has no entry for an unknown picker name", async () => {
    const map = await getPickerIdByName();
    expect(map["Nadie"]).toBeUndefined();
  });
});
