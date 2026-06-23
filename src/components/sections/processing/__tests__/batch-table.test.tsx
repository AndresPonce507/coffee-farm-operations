import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BatchStage, ProcessingBatch } from "@/lib/types";
import type { FermentBatch } from "@/lib/db/ferment";

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

// getFermentBatches — provides the uuid PKs for /ferment/[id] links.
const getFermentBatchesMock = vi.fn();
vi.mock("@/lib/db/ferment", () => ({
  getFermentBatches: () => getFermentBatchesMock(),
}));

function fermentBatch(over: Partial<FermentBatch>): FermentBatch {
  return {
    id: "fb-uuid-placeholder",
    lotCode: "JC-561",
    recipeId: null,
    method: "Natural",
    startedAt: "2026-06-14T08:00:00Z",
    endedAt: null,
    ...over,
  };
}

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
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-564", lotCode: "JC-564" }),
      fermentBatch({ id: "fb-uuid-561", lotCode: "JC-561" }),
      fermentBatch({ id: "fb-uuid-552", lotCode: "JC-552" }),
    ]);

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
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-561", lotCode: "JC-561" }),
    ]);

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
    getFermentBatchesMock.mockResolvedValue([]);

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
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-561", lotCode: "JC-561" }),
    ]);

    const ui = await BatchTable({ lots: ["JC-561"] });
    render(ui);

    // The LOT is green (terminal) → no advance trigger at all, even though the
    // batch row's stale stage ('fermentation') would have offered one.
    expect(
      screen.queryByRole("button", { name: /advance JC-561 to the next stage/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the LOT's authoritative stage in the Badge, not the stale batch.stage", async () => {
    // Round-A CRIT: an advance moves lots.stage but not the denormalized
    // processing_batches.stage. The Stage Badge must render the lot's stage so the
    // operator never sees a row that already advanced still labelled its old stage.
    getBatchesMock.mockResolvedValue([
      batch({ id: "b1", lotCode: "JC-561", stage: "fermentation" }),
    ]);
    getLotStagesMock.mockResolvedValue(stageMap({ "JC-561": "drying" }));
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-561", lotCode: "JC-561" }),
    ]);

    const ui = await BatchTable({ lots: ["JC-561"] });
    render(ui);

    // The Badge reflects lots.stage ("Drying"), never the stale batch.stage label.
    expect(screen.getByText("Drying")).toBeInTheDocument();
    expect(screen.queryByText("Fermentation")).not.toBeInTheDocument();
  });

  it("wraps each lot-code cell in an EntityLink navigating to /lots/[code]", async () => {
    getBatchesMock.mockResolvedValue([
      batch({ id: "b1", lotCode: "JC-564" }),
      batch({ id: "b2", lotCode: "JC-561" }),
    ]);
    getLotStagesMock.mockResolvedValue(
      stageMap({ "JC-564": "drying", "JC-561": "drying" }),
    );
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-564", lotCode: "JC-564" }),
      fermentBatch({ id: "fb-uuid-561", lotCode: "JC-561" }),
    ]);

    const ui = await BatchTable({ lots: ["JC-561", "JC-564"] });
    render(ui);

    // Every lot-code cell must be an anchor pointing at the /lots/[code] dossier.
    // Exact-match the code so the lot link is not confused with the sibling ferment
    // icon link, whose accessible name is now "Abrir tanda <code>" (human-readable).
    const lotLink564 = screen.getByRole("link", { name: "JC-564" });
    expect(lotLink564).toHaveAttribute("href", "/lots/JC-564");

    const lotLink561 = screen.getByRole("link", { name: "JC-561" });
    expect(lotLink561).toHaveAttribute("href", "/lots/JC-561");
  });

  it("renders an EntityLink per row navigating to the ferment dossier using the ferment_batches uuid (not the processing_batches slug)", async () => {
    // processing_batches.id values are slugs like 'b-602-geisha-anaerobic';
    // /ferment/[batch] resolves against ferment_batches.id (uuid PKs). Using
    // the processing slug as the href would always produce a 404. The component
    // must look up the ferment_batch by lot_code and use that row's uuid.
    getBatchesMock.mockResolvedValue([
      batch({ id: "b-602-geisha-anaerobic", lotCode: "JC-564" }),
      batch({ id: "b-561-caturra-natural", lotCode: "JC-561" }),
    ]);
    getLotStagesMock.mockResolvedValue(
      stageMap({ "JC-564": "drying", "JC-561": "drying" }),
    );
    // ferment_batches rows carry uuid PKs and are linked by lot_code.
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-real-uuid-564", lotCode: "JC-564" }),
      fermentBatch({ id: "fb-real-uuid-561", lotCode: "JC-561" }),
    ]);

    const ui = await BatchTable({ lots: ["JC-561", "JC-564"] });
    render(ui);

    // Links must use the ferment_batches uuid, NOT the processing_batches slug.
    expect(document.querySelector('a[href="/ferment/fb-real-uuid-564"]')).not.toBeNull();
    expect(document.querySelector('a[href="/ferment/fb-real-uuid-561"]')).not.toBeNull();

    // The old (wrong) processing-batch slugs must NOT appear as batch links.
    expect(document.querySelector('a[href="/ferment/b-602-geisha-anaerobic"]')).toBeNull();
    expect(document.querySelector('a[href="/ferment/b-561-caturra-natural"]')).toBeNull();
  });

  it("omits the batch icon link when no ferment_batch exists for that lot", async () => {
    // If no ferment_batch row exists for a lot_code, no link should render
    // (rather than a guaranteed-404 link to an id from the wrong table).
    getBatchesMock.mockResolvedValue([
      batch({ id: "b-999-no-ferment", lotCode: "JC-999" }),
    ]);
    getLotStagesMock.mockResolvedValue(stageMap({ "JC-999": "drying" }));
    // Deliberately empty — no ferment batch for this lot.
    getFermentBatchesMock.mockResolvedValue([]);

    const ui = await BatchTable({ lots: ["JC-999"] });
    render(ui);

    // No batch icon link should be present.
    expect(document.querySelector('a[href^="/ferment/"]')).toBeNull();
  });

  it("gives the batch open-icon EntityLink a 44px minimum hit area and a visible focus ring (WCAG 2.5.5 / 2.4.7)", async () => {
    getBatchesMock.mockResolvedValue([
      batch({ id: "batch-tap-test", lotCode: "JC-564" }),
    ]);
    getLotStagesMock.mockResolvedValue(stageMap({ "JC-564": "drying" }));
    getFermentBatchesMock.mockResolvedValue([
      fermentBatch({ id: "fb-uuid-tap-test", lotCode: "JC-564" }),
    ]);

    const ui = await BatchTable({ lots: ["JC-564"] });
    render(ui);

    // EntityLink builds aria-label="Abrir tanda {lotCode}" — a human-readable name
    // (the lot code), not the raw ferment uuid.
    const iconLink = screen.getByRole("link", { name: /abrir tanda JC-564/i });

    // Must have min-h-11 and min-w-11 (≥44px) so the touch target is large enough.
    expect(iconLink.className).toContain("min-h-11");
    expect(iconLink.className).toContain("min-w-11");

    // Must center the icon inside the expanded hit area.
    expect(iconLink.className).toContain("inline-flex");
    expect(iconLink.className).toContain("items-center");
    expect(iconLink.className).toContain("justify-center");

    // Focus ring must use ring, not a color-only change (WCAG 1.4.1 / 2.4.7).
    expect(iconLink.className).toContain("focus-visible:ring-2");
    // Must NOT rely solely on a text-color change for focus indication.
    expect(iconLink.className).not.toMatch(/focus-visible:text-forest-700\b/);
  });
});
