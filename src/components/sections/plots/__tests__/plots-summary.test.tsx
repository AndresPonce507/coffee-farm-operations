import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot } from "@/lib/types";

// The section is an async Server Component that reads from the DB layer; mock the
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

import { PlotsSummary } from "@/components/sections/plots/plots-summary";

describe("PlotsSummary (smoke)", () => {
  it("renders headline metrics from the data layer without throwing", async () => {
    const ui = await PlotsSummary();
    render(ui);
    expect(screen.getByText("Total area")).toBeInTheDocument();
    expect(screen.getByText("Need attention")).toBeInTheDocument();
    // 1 of 2 plots is non-healthy → "Need attention" tile shows 1
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
