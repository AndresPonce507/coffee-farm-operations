import { describe, expect, it } from "vitest";

import {
  mapIpmThreshold,
  mapPlotPhiStatus,
  mapPlotVegetation,
  mapSprayLogEntry,
  type IpmThresholdRow,
  type PlotPhiStatusRow,
  type PlotVegetationRow,
  type SprayLogRow,
} from "@/lib/db/remote-sensing";

/**
 * P2-S12 remote-sensing read-port: pin the pure row → domain mappers (snake_case →
 * camelCase, numeric coercion, honest-null handling). The fusion/threshold logic is
 * pinned in agronomy/*.test.ts + the DB test; this file pins the READ surface the
 * /satellite + /scouting UIs consume — especially that the HONEST confidence and a
 * null value (no signal) survive the mapping unflattened.
 */

describe("mapPlotVegetation — v_plot_vegetation row → domain", () => {
  const row: PlotVegetationRow = {
    plot_id: "p-talamanca",
    plot_name: "Talamanca",
    variety: "Caturra",
    altitude_masl: 1520,
    value: "0.61",
    index_kind: "sar-backscatter",
    confidence: "medium",
    basis: "sar",
    cloud_pct: "0",
    observed_at: "2026-06-20T12:00:00Z",
  };

  it("coerces numerics and preserves the honest confidence + basis", () => {
    const v = mapPlotVegetation(row);
    expect(v.plotId).toBe("p-talamanca");
    expect(v.altitudeMasl).toBe(1520);
    expect(v.value).toBeCloseTo(0.61, 5);
    expect(v.confidence).toBe("medium");
    expect(v.basis).toBe("sar");
  });

  it("keeps a null value + low confidence honest (a cloud-blind plot is never faked)", () => {
    const v = mapPlotVegetation({
      ...row,
      value: null,
      index_kind: null,
      cloud_pct: null,
      observed_at: null,
      confidence: "low",
    });
    expect(v.value).toBeNull();
    expect(v.confidence).toBe("low");
    expect(v.cloudPct).toBeNull();
    expect(v.observedAt).toBeNull();
  });
});

describe("mapIpmThreshold — v_ipm_threshold row → domain", () => {
  const row: IpmThresholdRow = {
    plot_id: "p-cuesta-piedra",
    plot_name: "Cuesta de Piedra",
    pest_kind: "broca",
    incidence_pct: "8",
    threshold: "5",
    recommend: true,
    observed_at: "2026-06-21T09:00:00Z",
    fired_task_id: "task-1",
  };

  it("coerces numerics and carries the recommend call + threshold", () => {
    const t = mapIpmThreshold(row);
    expect(t.pestKind).toBe("broca");
    expect(t.incidencePct).toBe(8);
    expect(t.threshold).toBe(5);
    expect(t.recommend).toBe(true);
    expect(t.firedTaskId).toBe("task-1");
  });

  it("preserves a null threshold for an unknown pest (no fabricated action)", () => {
    const t = mapIpmThreshold({ ...row, pest_kind: "mystery", threshold: null, recommend: false, fired_task_id: null });
    expect(t.threshold).toBeNull();
    expect(t.recommend).toBe(false);
    expect(t.firedTaskId).toBeNull();
  });
});

describe("mapPlotPhiStatus — v_plot_phi_status row → domain", () => {
  const row: PlotPhiStatusRow = {
    plot_id: "p-talamanca",
    plot_name: "Talamanca",
    product: "Verdadero 600",
    active_ingredient: "imidacloprid",
    applied_at: "2026-06-20T08:00:00Z",
    phi_clears_on: "2026-07-04",
    rei_clears_at: "2026-06-21T08:00:00Z",
    phi_active: true,
    rei_active: false,
  };

  it("carries the PHI/REI windows + active flags", () => {
    const p = mapPlotPhiStatus(row);
    expect(p.plotId).toBe("p-talamanca");
    expect(p.phiClearsOn).toBe("2026-07-04");
    expect(p.phiActive).toBe(true);
    expect(p.reiActive).toBe(false);
  });
});

describe("mapSprayLogEntry — v_spray_history row → domain", () => {
  const row: SprayLogRow = {
    id: 7,
    plot_id: "p-talamanca",
    plot_name: "Talamanca",
    product: "Verdadero 600",
    active_ingredient: "imidacloprid",
    phi_days: "14",
    rei_hours: "24",
    applied_at: "2026-06-20T08:00:00Z",
    worker_id: "w-agro",
    worker_name: "Lucía Mendez",
  };

  it("coerces the id + intervals and carries the certified applicator", () => {
    const e = mapSprayLogEntry(row);
    expect(e.id).toBe(7);
    expect(e.phiDays).toBe(14);
    expect(e.reiHours).toBe(24);
    expect(e.workerName).toBe("Lucía Mendez");
  });
});
