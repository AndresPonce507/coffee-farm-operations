import { describe, expect, it } from "vitest";

import {
  deriveAssignedPlots,
  summarizeProductivity,
} from "@/lib/db/dossier/crew";
import type { WeighByPicker } from "@/lib/db/weigh";
import type { DispatchCard } from "@/lib/types";

/**
 * Direct coverage of the PURE derivations in the /crew/[id] dossier read-port
 * (`src/lib/db/dossier/crew.ts`). The cache()'d getters wrap these around live
 * views (pinned by the db-suite); this file pins the in-memory roll-ups the
 * dossier's "assigned plots" + "productivity" sections depend on.
 */

function card(overrides: Partial<DispatchCard>): DispatchCard {
  return {
    id: 1,
    crewId: "crew-tizingal",
    crewName: "Crew Tizingal",
    dispatchDate: "2026-06-20",
    season: "2026",
    status: "sent",
    sentChannel: "web-share",
    readinessThreshold: 0.6,
    idempotencyKey: null,
    plotCount: 0,
    plots: [],
    ...overrides,
  };
}

function plotLine(plotId: string, name: string, alt = 1400) {
  return {
    id: Math.floor(Math.random() * 1e6),
    dispatchRunId: 1,
    plotId,
    plotName: name,
    variety: "Catuaí" as const,
    altitudeMasl: alt,
    taskKind: "picking",
    targetKg: null,
    ripenessTarget: "ripe" as const,
    readiness: 0.7,
    ord: 1,
  };
}

describe("deriveAssignedPlots", () => {
  it("collapses runs into DISTINCT plots, counts assignments, keeps the latest date", () => {
    const history: DispatchCard[] = [
      card({
        id: 1,
        dispatchDate: "2026-06-18",
        plots: [plotLine("p-norte-bajo", "Norte Bajo")],
      }),
      card({
        id: 2,
        dispatchDate: "2026-06-20",
        plots: [
          plotLine("p-norte-bajo", "Norte Bajo"),
          plotLine("p-tizingal-alto", "Tizingal Alto", 1700),
        ],
      }),
    ];

    const plots = deriveAssignedPlots(history);

    expect(plots).toHaveLength(2);
    const norte = plots.find((p) => p.plotId === "p-norte-bajo")!;
    expect(norte.runCount).toBe(2);
    expect(norte.lastDispatchDate).toBe("2026-06-20");
  });

  it("orders by most-recent dispatch date, then plot name", () => {
    const history: DispatchCard[] = [
      card({
        id: 1,
        dispatchDate: "2026-06-19",
        plots: [plotLine("p-a", "Alfa")],
      }),
      card({
        id: 2,
        dispatchDate: "2026-06-21",
        plots: [plotLine("p-z", "Zeta")],
      }),
    ];

    const plots = deriveAssignedPlots(history);

    expect(plots.map((p) => p.plotId)).toEqual(["p-z", "p-a"]);
  });

  it("returns [] for a crew with no dispatch history", () => {
    expect(deriveAssignedPlots([])).toEqual([]);
  });
});

describe("summarizeProductivity", () => {
  const picker = (
    id: string,
    name: string,
    kg: number,
    latas: number,
  ): WeighByPicker => ({
    workerId: id,
    name,
    crewId: "crew-tizingal",
    lataCount: latas,
    kgToday: kg,
    lastWeighAt: "2026-06-22T11:00:00Z",
  });

  it("sums kg + latas, counts pickers, sorts highest-kg first", () => {
    const result = summarizeProductivity([
      picker("w-01", "Ana", 30, 3),
      picker("w-02", "Beto", 70, 7),
    ]);

    expect(result.totalKg).toBe(100);
    expect(result.totalLatas).toBe(10);
    expect(result.pickerCount).toBe(2);
    expect(result.pickers.map((p) => p.workerId)).toEqual(["w-02", "w-01"]);
  });

  it("returns zeroed totals + no pickers for an empty crew (honest empty)", () => {
    const result = summarizeProductivity([]);
    expect(result).toEqual({
      pickers: [],
      totalKg: 0,
      totalLatas: 0,
      pickerCount: 0,
    });
  });
});
