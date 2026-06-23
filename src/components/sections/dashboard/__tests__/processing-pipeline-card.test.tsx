import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessingBatch } from "@/lib/types";

// ProcessingPipelineCard is an async Server Component that awaits getBatches.
// Mock the processing module so the smoke test renders against a known batch set.
vi.mock("@/lib/db/processing", () => ({
  getBatches: vi.fn(
    async (): Promise<ProcessingBatch[]> => [
      {
        id: "b1", lotCode: "JC-101", variety: "Geisha", method: "Washed",
        stage: "drying", startedDate: "2026-06-14", cherriesKg: 1200,
        currentKg: 240, moisturePct: 18, patio: "Bed 7", progressPct: 70,
      },
      {
        id: "b2", lotCode: "JC-102", variety: "Caturra", method: "Natural",
        stage: "fermentation", startedDate: "2026-06-18", cherriesKg: 900,
        currentKg: 900, moisturePct: 0, patio: "Tank 2", progressPct: 25,
      },
      {
        id: "b3", lotCode: "JC-103", variety: "Pacamara", method: "Honey",
        stage: "parchment", startedDate: "2026-06-10", cherriesKg: 600,
        currentKg: 110, moisturePct: 12, patio: "Bed 3", progressPct: 85,
      },
    ],
  ),
}));

import { ProcessingPipelineCard } from "@/components/sections/dashboard/processing-pipeline-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("ProcessingPipelineCard (smoke)", () => {
  it("renders the card title and stage labels without throwing", async () => {
    const ui = await ProcessingPipelineCard();
    render(ui);

    expect(screen.getByText("Processing pipeline")).toBeInTheDocument();
    expect(screen.getByText("Cherry")).toBeInTheDocument();
    expect(screen.getByText("Drying")).toBeInTheDocument();
    expect(screen.getByText("Green")).toBeInTheDocument();
  });

  it("derives summary + closest-to-green entries from the data layer", async () => {
    const ui = await ProcessingPipelineCard();
    render(ui);

    // Header description: "3 batches in process · 1,250 kg on the beds"
    // (in-flight kg = 240 + 900 + 110 = 1,250).
    expect(
      screen.getByText(/3 batches in process/),
    ).toBeInTheDocument();
    // "Closest to green" surfaces the highest-stage batches not yet green.
    expect(screen.getByText("Closest to green")).toBeInTheDocument();
    expect(screen.getByText("JC-103")).toBeInTheDocument();
    expect(screen.getByText("JC-101")).toBeInTheDocument();
  });

  it("wires each closest-to-green lot to its lot dossier (no dead UI)", async () => {
    const ui = await ProcessingPipelineCard();
    render(ui);

    // The lot code in each "Closest to green" row is now a real <a href> to /lots/[code].
    const jc103 = screen.getByText("JC-103").closest("a");
    expect(jc103).not.toBeNull();
    expect(jc103).toHaveAttribute("href", "/lots/JC-103");

    const jc101 = screen.getByText("JC-101").closest("a");
    expect(jc101).toHaveAttribute("href", "/lots/JC-101");
  });
});
