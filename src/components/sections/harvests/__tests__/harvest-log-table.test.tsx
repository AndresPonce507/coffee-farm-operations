import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Harvest } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network.
vi.mock("@/lib/db/harvests", () => ({
  getHarvests: vi.fn(
    async (): Promise<Harvest[]> => [
      {
        id: "h1", date: "2026-06-20", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Marisol Quintero", cherriesKg: 120, ripenessPct: 96,
        brixAvg: 21.4, lotCode: "JC-564",
      },
      {
        id: "h2", date: "2026-06-19", plotId: "p2", plotName: "Paso Ancho",
        picker: "Diego Santamaría", cherriesKg: 80, ripenessPct: 90,
        brixAvg: 20.0, lotCode: "JC-565",
      },
    ],
  ),
}));

// HarvestRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/harvests", () => ({
  createHarvest: vi.fn(),
  updateHarvest: vi.fn(),
  deleteHarvest: vi.fn(),
  IDLE: { status: "idle" },
}));

import { HarvestLogTable } from "@/components/sections/harvests/harvest-log-table";

describe("HarvestLogTable (smoke)", () => {
  it("renders the traceability ledger from the data layer without throwing", async () => {
    const ui = await HarvestLogTable({ plots: [], pickers: [], lots: [] });
    render(ui);

    expect(screen.getByText("Harvest log")).toBeInTheDocument();
    // Lot codes and plot names from the two rows surface in the table body.
    expect(screen.getByText("JC-564")).toBeInTheDocument();
    expect(screen.getByText("Tizingal Alto")).toBeInTheDocument();
    expect(screen.getByText("Paso Ancho")).toBeInTheDocument();
  });
});
