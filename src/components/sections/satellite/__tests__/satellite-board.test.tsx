import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlotVegetation } from "@/lib/types";

const getPlotVegetation = vi.fn();
vi.mock("@/lib/db/remote-sensing", () => ({
  getPlotVegetation: () => getPlotVegetation(),
}));

import { SatelliteBoard } from "@/components/sections/satellite/satellite-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rows: PlotVegetation[] = [
  {
    plotId: "p-cuesta-piedra",
    plotName: "Cuesta de Piedra",
    variety: "Catuaí",
    altitudeMasl: 1360,
    value: 0.78,
    indexKind: "ndvi",
    confidence: "high",
    basis: "optical",
    cloudPct: 5,
    observedAt: "2026-06-20T12:00:00Z",
  },
  {
    plotId: "p-las-lagunas",
    plotName: "Las Lagunas",
    variety: "Geisha",
    altitudeMasl: 1700,
    value: null,
    indexKind: null,
    confidence: "low",
    basis: "optical",
    cloudPct: null,
    observedAt: null,
  },
];

describe("SatelliteBoard (async Server Component render)", () => {
  it("renders the vegetation grid with a headline confidence summary", async () => {
    getPlotVegetation.mockResolvedValue(rows);
    render(await SatelliteBoard());
    expect(screen.getByText("Cuesta de Piedra")).toBeInTheDocument();
    // a headline strip surfaces how many plots we can see clearly vs honestly cannot
    expect(screen.getByTestId("sat-high-count")).toBeInTheDocument();
  });

  it("renders the empty state honestly when there are no reads", async () => {
    getPlotVegetation.mockResolvedValue([]);
    render(await SatelliteBoard());
    expect(screen.getByTestId("vegetation-empty")).toBeInTheDocument();
  });
});
