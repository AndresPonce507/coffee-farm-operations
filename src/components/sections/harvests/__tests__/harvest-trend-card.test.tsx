import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Harvest } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network.
vi.mock("@/lib/db/harvests", () => ({
  getHarvests: vi.fn(
    async (): Promise<Harvest[]> => [
      {
        id: "h1", date: "2026-06-18", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Marisol Quintero", cherriesKg: 120, ripenessPct: 96,
        brixAvg: 21.4, lotCode: "JC-564",
      },
      {
        id: "h2", date: "2026-06-19", plotId: "p2", plotName: "Paso Ancho",
        picker: "Diego Santamaría", cherriesKg: 300, ripenessPct: 92,
        brixAvg: 20.0, lotCode: "JC-565",
      },
      {
        id: "h3", date: "2026-06-20", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Ana Beltrán", cherriesKg: 90, ripenessPct: 95,
        brixAvg: 21.1, lotCode: "JC-566",
      },
    ],
  ),
}));

import { HarvestTrendCard } from "@/components/sections/harvests/harvest-trend-card";

describe("HarvestTrendCard (smoke)", () => {
  it("renders the daily-harvest chart from the data layer without throwing", async () => {
    const ui = await HarvestTrendCard();
    render(ui);

    expect(screen.getByText("Daily harvest (kg)")).toBeInTheDocument();
    expect(screen.getByText("Best day")).toBeInTheDocument();
    // Best day is 2026-06-19 with the 300 kg total → "Jun 19 · 300 kg".
    expect(screen.getByText("Jun 19 · 300 kg")).toBeInTheDocument();
  });
});
