import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IpmThresholdStatus, PlotPhiStatus, SprayLogEntry } from "@/lib/types";

const getIpmThresholds = vi.fn();
const getPlotPhiStatus = vi.fn();
const getSprayHistory = vi.fn();
const getValidApplicators = vi.fn();
const getPlotOptions = vi.fn();

vi.mock("@/lib/db/remote-sensing", () => ({
  getIpmThresholds: () => getIpmThresholds(),
  getPlotPhiStatus: () => getPlotPhiStatus(),
  getSprayHistory: () => getSprayHistory(),
}));
vi.mock("@/lib/db/ipm-applicators", () => ({
  getValidApplicators: () => getValidApplicators(),
  getPlotOptions: () => getPlotOptions(),
}));

import { IpmBoard } from "@/components/sections/ipm/ipm-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const threshold: IpmThresholdStatus = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  pestKind: "broca",
  incidencePct: 8,
  threshold: 5,
  recommend: true,
  observedAt: "2026-06-21T09:00:00Z",
  firedTaskId: "task-1",
};

const phi: PlotPhiStatus = {
  plotId: "p-talamanca",
  plotName: "Talamanca",
  product: "Verdadero 600",
  activeIngredient: "imidacloprid",
  appliedAt: "2026-06-20T08:00:00Z",
  phiClearsOn: "2026-07-04",
  reiClearsAt: "2026-06-21T08:00:00Z",
  phiActive: true,
  reiActive: false,
};

const spray: SprayLogEntry = {
  id: 1,
  plotId: "p-talamanca",
  plotName: "Talamanca",
  product: "Verdadero 600",
  activeIngredient: "imidacloprid",
  phiDays: 14,
  reiHours: 24,
  appliedAt: "2026-06-20T08:00:00Z",
  workerId: "w-agro",
  workerName: "Lucía Mendez",
};

describe("IpmBoard (async Server Component render)", () => {
  it("renders the scouting board, a spray-log form and the PHI chips together", async () => {
    getIpmThresholds.mockResolvedValue([threshold]);
    getPlotPhiStatus.mockResolvedValue([phi]);
    getSprayHistory.mockResolvedValue([spray]);
    getValidApplicators.mockResolvedValue([
      { id: "w-agro", name: "Lucía Mendez", certified: true },
    ]);
    getPlotOptions.mockResolvedValue([{ id: "p-talamanca", name: "Talamanca" }]);

    render(await IpmBoard());

    // scouting card
    expect(screen.getByTestId("scouting-p-cuesta-piedra-broca")).toBeInTheDocument();
    // the cert-gated spray form
    expect(screen.getByTestId("spray-form")).toBeInTheDocument();
    // a PHI countdown chip (the harvest-block surface)
    expect(screen.getByTestId("phi-p-talamanca")).toBeInTheDocument();
  });

  it("renders honest empty states when nothing has been scouted or sprayed", async () => {
    getIpmThresholds.mockResolvedValue([]);
    getPlotPhiStatus.mockResolvedValue([]);
    getSprayHistory.mockResolvedValue([]);
    getValidApplicators.mockResolvedValue([]);
    getPlotOptions.mockResolvedValue([]);

    render(await IpmBoard());
    expect(screen.getByTestId("scouting-empty")).toBeInTheDocument();
  });
});
