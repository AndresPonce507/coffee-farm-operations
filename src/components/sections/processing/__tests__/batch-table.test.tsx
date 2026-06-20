import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingBatch } from "@/lib/types";

// BatchTable is an async Server Component that reads from the DB layer; mock the
// getter so the smoke test renders against a known shape with no network.
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
        currentKg: 420, moisturePct: 18, patio: "Bed 7", progressPct: 55,
      },
      {
        id: "b3", lotCode: "JC-552", variety: "Pacamara", method: "Honey",
        stage: "green", startedDate: "2026-06-02", cherriesKg: 1500,
        currentKg: 240, moisturePct: 11, patio: "Bed 1", progressPct: 98,
      },
    ],
  ),
}));

import { BatchTable } from "@/components/sections/processing/batch-table";

describe("BatchTable (smoke)", () => {
  it("renders the card header, columns, and batch rows without throwing", async () => {
    const ui = await BatchTable();
    render(ui);

    // Card title + a stable column header.
    expect(screen.getByText("All batches")).toBeInTheDocument();
    expect(screen.getByText("Variety")).toBeInTheDocument();
    expect(screen.getByText("Method")).toBeInTheDocument();

    // Active count badge = number of mocked rows.
    expect(screen.getByText("3 active")).toBeInTheDocument();

    // Each mocked batch renders a row keyed by its lot code.
    expect(screen.getByText("JC-564")).toBeInTheDocument();
    expect(screen.getByText("JC-561")).toBeInTheDocument();
    expect(screen.getByText("JC-552")).toBeInTheDocument();
  });
});
