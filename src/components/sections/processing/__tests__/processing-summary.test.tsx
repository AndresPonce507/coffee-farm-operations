import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingBatch } from "@/lib/types";

// ProcessingSummary is an async Server Component that derives headline numbers
// live from the DB layer; mock the getter so the smoke test renders against a
// known shape with no network. Two drying beds + one green lot make the derived
// totals deterministic.
vi.mock("@/lib/db/processing", () => ({
  getBatches: vi.fn(
    async (): Promise<ProcessingBatch[]> => [
      {
        id: "b1", lotCode: "JC-564", variety: "Geisha", method: "Washed",
        stage: "fermentation", startedDate: "2026-06-18", cherriesKg: 1240,
        currentKg: 1180, moisturePct: 60, patio: "Tank 3", progressPct: 22,
      },
      {
        id: "b2", lotCode: "JC-561", variety: "Caturra", method: "Natural",
        stage: "drying", startedDate: "2026-06-14", cherriesKg: 980,
        currentKg: 300, moisturePct: 20, patio: "Bed 7", progressPct: 55,
      },
      {
        id: "b3", lotCode: "JC-558", variety: "Catuaí", method: "Honey",
        stage: "drying", startedDate: "2026-06-12", cherriesKg: 760,
        currentKg: 200, moisturePct: 14, patio: "Bed 4", progressPct: 62,
      },
      {
        id: "b4", lotCode: "JC-552", variety: "Pacamara", method: "Anaerobic",
        stage: "green", startedDate: "2026-06-02", cherriesKg: 1500,
        currentKg: 240, moisturePct: 11, patio: "Bed 1", progressPct: 98,
      },
    ],
  ),
}));

import { ProcessingSummary } from "@/components/sections/processing/processing-summary";

describe("ProcessingSummary (smoke)", () => {
  it("renders the headline KPI tiles from the data layer without throwing", async () => {
    const ui = await ProcessingSummary();
    render(ui);

    // The four tile labels are stable copy.
    expect(screen.getByText("Active batches")).toBeInTheDocument();
    expect(screen.getByText("On drying beds")).toBeInTheDocument();
    expect(screen.getByText("Avg moisture")).toBeInTheDocument();
    expect(screen.getByText("Green ready")).toBeInTheDocument();

    // Active = anything not yet green: 3 of the 4 mocked batches.
    expect(screen.getByText("3")).toBeInTheDocument();
    // On drying beds = 300 + 200 = 500 kg across 2 resting beds.
    expect(screen.getByText("500 kg")).toBeInTheDocument();
    expect(screen.getByText("2 beds resting")).toBeInTheDocument();
    // Green ready = the single green lot's current weight.
    expect(screen.getByText("240 kg")).toBeInTheDocument();
  });
});
