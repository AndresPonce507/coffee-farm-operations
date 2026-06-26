import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FermentBatch } from "@/lib/db/ferment";

// The page is an async Server Component that resolves a batch from the batch
// list then awaits the curve / cut-point / water reads. Mock the read ports so
// the page composes against a seeded batch with no Supabase.
const batch: FermentBatch = {
  id: "batch-uuid-1",
  lotCode: "JC-800",
  recipeId: null,
  method: "washed",
  startedAt: "2026-05-20T06:00:00Z",
  endedAt: null,
};

vi.mock("@/lib/db/ferment", () => ({
  getFermentBatches: vi.fn(async () => [batch]),
  getFermentCurve: vi.fn(async () => []),
  getFermentCutpoint: vi.fn(async () => null),
  getWaterPerKg: vi.fn(async () => null),
}));

// Stub the heavy interactive tracker island so the test asserts the PAGE's job:
// the dossier chrome wrapping the tracker, with the batch it resolved.
vi.mock("@/components/sections/ferment/ferment-tracker", () => ({
  FermentTracker: ({ batch: b }: { batch: { id: string } }) => (
    <div data-testid="ferment-tracker-stub" data-batch={b.id} />
  ),
}));

// next/navigation's notFound() throws a sentinel that the router catches to
// render the 404 page. Mock it so the test can assert the page short-circuits.
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import FermentBatchPage from "@/app/(app)/ferment/[batch]/page";
import { getFermentCurve } from "@/lib/db/ferment";
import { notFound } from "next/navigation";

afterEach(cleanup);

describe("/ferment/[batch] page (smoke)", () => {
  it("retrofits the batch tracker into the shared <DossierShell>", async () => {
    const ui = await FermentBatchPage({
      params: Promise.resolve({ batch: "batch-uuid-1" }),
    });
    render(ui);

    // The dossier shell (data-dossier="batch") wraps the tracker with a
    // localized eyebrow + back link — chrome shared across all 7 dossiers.
    expect(screen.getByTestId("dossier-batch")).toBeInTheDocument();
    expect(screen.getByText("Lot in fermentation")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /all fermentations/i }),
    ).toHaveAttribute("href", "/ferment");

    // The data is unchanged: the section reads still fire for the resolved batch
    // and the tracker renders for it.
    expect(getFermentCurve).toHaveBeenCalledWith("batch-uuid-1");
    const tracker = screen.getByTestId("ferment-tracker-stub");
    expect(tracker).toHaveAttribute("data-batch", "batch-uuid-1");
  });

  it("calls notFound() for an unknown batch id instead of fabricating a tracker", async () => {
    vi.mocked(notFound).mockClear();

    await expect(
      FermentBatchPage({ params: Promise.resolve({ batch: "does-not-exist" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
