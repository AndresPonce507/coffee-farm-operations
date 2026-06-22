import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot } from "@/lib/types";

// PlotsTable is an async Server Component that reads from the DB layer; mock the
// getter so the smoke test renders against a known shape with no network.
vi.mock("@/lib/db/plots", () => ({
  getPlots: vi.fn(
    async (): Promise<Plot[]> => [
      {
        id: "p1", name: "Tizingal Alto", block: "Block A", variety: "Geisha",
        areaHa: 4.2, altitudeMasl: 1690, trees: 14800, shadePct: 55,
        establishedYear: 2014, status: "healthy", lastInspected: "2026-06-18",
        expectedYieldKg: 18600, harvestedKg: 12120,
      },
      {
        id: "p2", name: "Paso Ancho", block: "Block C", variety: "Pacamara",
        areaHa: 3.7, altitudeMasl: 1450, trees: 11200, shadePct: 44,
        establishedYear: 2017, status: "at-risk", lastInspected: "2026-06-15",
        expectedYieldKg: 12600, harvestedKg: 4100,
      },
    ],
  ),
}));

// PlotRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/plots", () => ({
  createPlot: vi.fn(),
  updatePlot: vi.fn(),
  deletePlot: vi.fn(),
  IDLE: { status: "idle" },
}));

import { PlotsTable } from "@/components/sections/plots/plots-table";

describe("PlotsTable (smoke)", () => {
  it("renders the table headers and plot rows without throwing", async () => {
    const ui = await PlotsTable();
    render(ui);

    // Card title + a stable column header.
    expect(screen.getByText("All plots")).toBeInTheDocument();
    expect(screen.getByText("Variety")).toBeInTheDocument();

    // Each mocked plot renders a row keyed by its name.
    expect(screen.getByText("Tizingal Alto")).toBeInTheDocument();
    expect(screen.getByText("Paso Ancho")).toBeInTheDocument();
  });

  // Phase 5 D2 — the formerly-COSMETIC plot name cell now drills into /plots/[id].
  it("links each table row's plot name to its plot dossier", async () => {
    const ui = await PlotsTable();
    render(ui);

    // EntityLink carries an es-PA aria-label; the visible plot name nests inside it.
    const link = screen.getByRole("link", { name: /plot p1/i });
    expect(link).toHaveAttribute("href", "/plots/p1");
    expect(link).toHaveTextContent("Tizingal Alto");
  });
});
