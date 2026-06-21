import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BatchStage, ProcessingBatch } from "@/lib/types";

// BatchTable is an async Server Component that reads from the DB layer; mock the
// getters so the smoke test renders against a known shape with no network.
const getBatchesMock = vi.fn();
vi.mock("@/lib/db/processing", () => ({
  getBatches: () => getBatchesMock(),
}));

// The LOT's authoritative stage per lot_code (lots.stage) — the coherence SSOT
// the advance control reads its "from" stage from.
const getLotStagesMock = vi.fn();
vi.mock("@/lib/db/processing-lots", () => ({
  getLotStages: () => getLotStagesMock(),
}));

// BatchRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/processing", () => ({
  createBatch: vi.fn(),
  updateBatch: vi.fn(),
  deleteBatch: vi.fn(),
  IDLE: { status: "idle" },
}));

import { BatchTable } from "@/components/sections/processing/batch-table";

const batch = (over: Partial<ProcessingBatch>): ProcessingBatch => ({
  id: "b?", lotCode: "JC-561", variety: "Caturra", method: "Natural",
  stage: "drying", startedDate: "2026-06-14", cherriesKg: 980,
  currentKg: 420, moisturePct: 18, patio: "Bed 7", progressPct: 55,
  ...over,
});

function stageMap(entries: Record<string, BatchStage>): Map<string, BatchStage> {
  return new Map(Object.entries(entries));
}

describe("BatchTable (smoke)", () => {
  it("renders the card header, columns, and batch rows without throwing", async () => {
    getBatchesMock.mockResolvedValue([
      batch({ id: "b1", lotCode: "JC-564", variety: "Geisha", method: "Washed", stage: "fermentation", progressPct: 22 }),
      batch({ id: "b2", lotCode: "JC-561" }),
      batch({ id: "b3", lotCode: "JC-552", variety: "Pacamara", method: "Honey", stage: "green", progressPct: 98 }),
    ]);
    getLotStagesMock.mockResolvedValue(
      stageMap({ "JC-564": "fermentation", "JC-561": "drying", "JC-552": "green" }),
    );

    const ui = await BatchTable({ lots: ["JC-552", "JC-561", "JC-564"] });
    render(ui);

    expect(screen.getByText("All batches")).toBeInTheDocument();
    expect(screen.getByText("Variety")).toBeInTheDocument();
    expect(screen.getByText("Method")).toBeInTheDocument();
    expect(screen.getByText("3 active")).toBeInTheDocument();

    expect(screen.getByText("JC-564")).toBeInTheDocument();
    expect(screen.getByText("JC-561")).toBeInTheDocument();
    expect(screen.getByText("JC-552")).toBeInTheDocument();
  });

  it("renders exactly ONE advance affordance per lot_code, even with several batches for that lot", async () => {
    // Two processing_batches rows for the SAME lot JC-561 — the old defect
    // rendered an Advance button on EACH, all mutating the one shared lot.
    getBatchesMock.mockResolvedValue([
      batch({ id: "b1", lotCode: "JC-561", stage: "drying" }),
      batch({ id: "b2", lotCode: "JC-561", stage: "fermentation" }),
    ]);
    getLotStagesMock.mockResolvedValue(stageMap({ "JC-561": "drying" }));

    const ui = await BatchTable({ lots: ["JC-561"] });
    render(ui);

    // Exactly one advance trigger for the lot (deduped by lot_code).
    const advanceButtons = screen.getAllByRole("button", {
      name: /advance JC-561 to the next stage/i,
    });
    expect(advanceButtons).toHaveLength(1);
  });

  it("renders a single empty-state row when there are no batches", async () => {
    getBatchesMock.mockResolvedValue([]);
    getLotStagesMock.mockResolvedValue(stageMap({}));

    const ui = await BatchTable({ lots: [] });
    render(ui);

    // A tasteful empty-state message stands in for the missing rows …
    expect(screen.getByText(/no batches in process/i)).toBeInTheDocument();
    // … and not a single batch row is rendered.
    expect(
      screen.queryByRole("button", { name: /advance .* to the next stage/i }),
    ).not.toBeInTheDocument();
  });

  it("keys the advance control off the LOT's stage (lots.stage), not the stale batch.stage", async () => {
    // The batch row claims 'fermentation' but the LOT has already advanced to
    // 'drying'. The advance affordance must derive its forward set from the LOT's
    // stage, so the trigger reflects the lot, not the stale processing_batches row.
    getBatchesMock.mockResolvedValue([
      batch({ id: "b1", lotCode: "JC-561", stage: "fermentation" }),
    ]);
    getLotStagesMock.mockResolvedValue(stageMap({ "JC-561": "green" }));

    const ui = await BatchTable({ lots: ["JC-561"] });
    render(ui);

    // The LOT is green (terminal) → no advance trigger at all, even though the
    // batch row's stale stage ('fermentation') would have offered one.
    expect(
      screen.queryByRole("button", { name: /advance JC-561 to the next stage/i }),
    ).not.toBeInTheDocument();
  });
});
