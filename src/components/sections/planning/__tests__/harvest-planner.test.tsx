import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PasadaPlan, PlotReadiness } from "@/lib/types";

const getHarvestReadiness = vi.fn();
const getPasadaCalendar = vi.fn();

vi.mock("@/lib/db/planning", () => ({
  getHarvestReadiness: () => getHarvestReadiness(),
  getPasadaCalendar: () => getPasadaCalendar(),
}));

import { HarvestPlanner } from "@/components/sections/planning/harvest-planner";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const readyPlot: PlotReadiness = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  variety: "Catuaí",
  altitudeMasl: 1360,
  bloomDate: "2026-01-15",
  gddAccumulated: 2200,
  gddToCherry: 2200,
  ndviLatest: 0.7,
  recentRipenessPct: 94,
  readiness: 0.95,
  confidence: "high",
  staggerDays: 0,
  predictedReadyDate: "2026-04-01",
};

const earlyPlot: PlotReadiness = {
  ...readyPlot,
  plotId: "p-las-lagunas",
  plotName: "Las Lagunas",
  altitudeMasl: 1700,
  readiness: 0.2,
  confidence: "low",
  predictedReadyDate: null,
};

const plan: PasadaPlan = {
  id: 1,
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  variety: "Catuaí",
  altitudeMasl: 1360,
  season: "2026",
  pasadaNumber: 1,
  predictedReadyDate: "2026-04-01",
  ripenessTarget: "high",
  status: "planned",
  reason: null,
  firedTaskId: "t-1",
};

describe("HarvestPlanner (async Server Component render)", () => {
  it("renders the readiness list and the pasada timeline together", async () => {
    getHarvestReadiness.mockResolvedValue([readyPlot, earlyPlot]);
    getPasadaCalendar.mockResolvedValue([plan]);

    render(await HarvestPlanner());

    expect(screen.getAllByText("Cuesta de Piedra").length).toBeGreaterThan(0);
    expect(screen.getByText("Las Lagunas")).toBeInTheDocument();
    // the readiness meter (list) renders
    expect(screen.getAllByRole("progressbar").length).toBe(2);
    // the timeline renders the scheduled pass
    expect(screen.getByTestId("pasada-1")).toBeInTheDocument();
  });

  it("shows a headline count of plots ready to pick", async () => {
    getHarvestReadiness.mockResolvedValue([readyPlot, earlyPlot]);
    getPasadaCalendar.mockResolvedValue([]);

    render(await HarvestPlanner());
    // exactly one plot is at/above the ready threshold.
    const headline = screen.getByTestId("plan-ready-count");
    expect(headline).toHaveTextContent("1");
  });

  it("renders both empty states when there is no data (honest, never blank)", async () => {
    getHarvestReadiness.mockResolvedValue([]);
    getPasadaCalendar.mockResolvedValue([]);

    render(await HarvestPlanner());
    expect(screen.getByTestId("readiness-empty")).toBeInTheDocument();
    expect(screen.getByTestId("pasada-empty")).toBeInTheDocument();
  });
});
