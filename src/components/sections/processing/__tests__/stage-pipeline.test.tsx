import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingBatch } from "@/lib/types";
import type { FermentBatch } from "@/lib/db/ferment";

// StagePipeline is an async Server Component rendering a kanban board across all
// six stages (cherry → green). Mock the getter so the smoke test renders against
// a known shape with no network. Batches span MULTIPLE stages with varying
// progressPct so the hero selection (furthest along) and every stage column —
// including an empty one — render.
vi.mock("@/lib/db/processing", () => ({
  getBatches: vi.fn(
    async (): Promise<ProcessingBatch[]> => [
      {
        id: "b1", lotCode: "JC-570", variety: "Geisha", method: "Washed",
        stage: "cherry", startedDate: "2026-06-20", cherriesKg: 1300,
        currentKg: 1300, moisturePct: 62, patio: "Intake A", progressPct: 8,
      },
      {
        id: "b2", lotCode: "JC-564", variety: "Caturra", method: "Anaerobic",
        stage: "fermentation", startedDate: "2026-06-18", cherriesKg: 1240,
        currentKg: 1180, moisturePct: 60, patio: "Tank 3", progressPct: 24,
      },
      {
        id: "b3", lotCode: "JC-561", variety: "Catuaí", method: "Natural",
        stage: "drying", startedDate: "2026-06-14", cherriesKg: 980,
        currentKg: 420, moisturePct: 18, patio: "Bed 7", progressPct: 52,
      },
      {
        id: "b4", lotCode: "JC-558", variety: "Pacamara", method: "Honey",
        stage: "milled", startedDate: "2026-06-08", cherriesKg: 1120,
        currentKg: 300, moisturePct: 12, patio: "Mill", progressPct: 78,
      },
      {
        id: "b5", lotCode: "JC-552", variety: "Typica", method: "Washed",
        stage: "green", startedDate: "2026-06-02", cherriesKg: 1500,
        currentKg: 240, moisturePct: 11, patio: "Bed 1", progressPct: 97,
      },
    ],
  ),
}));

// getFermentBatches provides ferment_batches UUIDs keyed by lotCode.
// Three of the five lots have a matching ferment run; two (JC-570/JC-558) do not.
vi.mock("@/lib/db/ferment", () => ({
  getFermentBatches: vi.fn(
    async (): Promise<FermentBatch[]> => [
      { id: "fb-uuid-564", lotCode: "JC-564", recipeId: null, method: "Anaerobic", startedAt: "2026-06-18T10:00:00Z", endedAt: null },
      { id: "fb-uuid-561", lotCode: "JC-561", recipeId: null, method: "Natural",   startedAt: "2026-06-14T08:00:00Z", endedAt: null },
      { id: "fb-uuid-552", lotCode: "JC-552", recipeId: null, method: "Washed",    startedAt: "2026-06-02T07:00:00Z", endedAt: "2026-06-05T07:00:00Z" },
    ],
  ),
}));

import { StagePipeline } from "@/components/sections/processing/stage-pipeline";

describe("StagePipeline (smoke)", () => {
  it("renders the heading and every stage column without throwing", async () => {
    const ui = await StagePipeline();
    render(ui);

    // Section heading.
    expect(screen.getByText("Processing pipeline")).toBeInTheDocument();
    // Total lots-in-process label.
    expect(screen.getByText("5 lots in process")).toBeInTheDocument();

    // All six stage columns render their aria-labelled regions.
    for (const stage of [
      "Cherry", "Fermentation", "Drying", "Parchment", "Milled", "Green",
    ]) {
      expect(
        screen.getByRole("region", { name: `${stage} stage` }),
      ).toBeInTheDocument();
    }

    // The empty stage (parchment — no mocked batch) shows the placeholder.
    expect(screen.getByText("No lots in this stage")).toBeInTheDocument();

    // A batch tile from a populated stage renders by lot code, and the hero
    // (furthest along, JC-552 at 97%) is among them.
    expect(screen.getByText("JC-570")).toBeInTheDocument();
    expect(screen.getByText("JC-552")).toBeInTheDocument();
  });

  it("each BatchTile lot-code label links to /lots/[code]", async () => {
    const ui = await StagePipeline();
    render(ui);

    // Every lot code must be wrapped in an <a> pointing to /lots/[code].
    const lotLinks = [
      { code: "JC-570", href: "/lots/JC-570" },
      { code: "JC-564", href: "/lots/JC-564" },
      { code: "JC-561", href: "/lots/JC-561" },
      { code: "JC-558", href: "/lots/JC-558" },
      { code: "JC-552", href: "/lots/JC-552" },
    ];

    for (const { code, href } of lotLinks) {
      const link = screen.getByRole("link", { name: new RegExp(`Abrir lote ${code}`) });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveTextContent(code);
    }
  });

  it("BatchTile 'View lot' links use ferment_batches UUID, not processing_batches id", async () => {
    const ui = await StagePipeline();
    render(ui);

    // Lots with a matching ferment_batches row must link to /ferment/<uuid>.
    // These UUIDs come from the getFermentBatches mock — NOT from processing_batches.id.
    expect(document.querySelector('a[href="/ferment/fb-uuid-564"]')).not.toBeNull();
    expect(document.querySelector('a[href="/ferment/fb-uuid-561"]')).not.toBeNull();
    expect(document.querySelector('a[href="/ferment/fb-uuid-552"]')).not.toBeNull();

    // The stale processing_batches ids must NOT appear as link targets.
    expect(document.querySelector('a[href="/ferment/b2"]')).toBeNull();
    expect(document.querySelector('a[href="/ferment/b3"]')).toBeNull();
    expect(document.querySelector('a[href="/ferment/b5"]')).toBeNull();
  });

  it("BatchTile omits 'View lot' link when no ferment run exists for that lot", async () => {
    const ui = await StagePipeline();
    render(ui);

    // JC-570 (b1) and JC-558 (b4) have no ferment batch in the mock.
    // Their tiles must not emit a /ferment/b1 or /ferment/b4 link.
    expect(document.querySelector('a[href="/ferment/b1"]')).toBeNull();
    expect(document.querySelector('a[href="/ferment/b4"]')).toBeNull();
  });
});
