import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Harvest } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. Both rows are dated on the
// component's hardcoded "today" (2026-06-20) so the derived totals are deterministic.
vi.mock("@/lib/db/harvests", () => ({
  getHarvests: vi.fn(
    async (): Promise<Harvest[]> => [
      {
        id: "h1", date: "2026-06-20", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Marisol Quintero", cherriesKg: 120, ripenessPct: 96,
        brixAvg: 21.4, lotCode: "JC-564",
      },
      {
        id: "h2", date: "2026-06-20", plotId: "p2", plotName: "Paso Ancho",
        picker: "Diego Santamaría", cherriesKg: 80, ripenessPct: 90,
        brixAvg: 20.0, lotCode: "JC-565",
      },
    ],
  ),
}));

import { HarvestSummary } from "@/components/sections/harvests/harvest-summary";

describe("HarvestSummary (smoke)", () => {
  it("renders KPI tiles from the data layer without throwing", async () => {
    const ui = await HarvestSummary();
    render(ui);

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Avg ripeness")).toBeInTheDocument();
    expect(screen.getByText("Avg Brix")).toBeInTheDocument();

    // Today (and last-7-days) total = 120 + 80 = 200 kg; both tiles show "200 kg".
    expect(screen.getAllByText("200 kg").length).toBeGreaterThanOrEqual(1);
    // 2 lots picked today.
    expect(screen.getByText("2 lots picked")).toBeInTheDocument();
  });
});
