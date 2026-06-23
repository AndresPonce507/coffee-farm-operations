import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page is an async Server Component that awaits, in parallel, the lineage,
// QC status, cupper roster, and defects. Mock the read ports so the page
// composes against seeded data with no Supabase. The page gates on an existence
// check: a cuppable lot always has a v_qc_status roll-up row, so an unknown code
// resolves to no row → notFound() instead of a fabricated scoresheet.
vi.mock("@/lib/db/lots", () => ({
  getLotGenealogy: vi.fn(async () => ({ nodes: [], edges: [] })),
}));
const getQcStatus = vi.fn(async () => [
  {
    greenLotCode: "JC-800",
    held: false,
    holdReason: null,
    latestCupScore: null,
    primaryDefects: 0,
    secondaryDefects: 0,
  },
]);
vi.mock("@/lib/db/qc", () => ({
  getQcStatus: () => getQcStatus(),
  getGreenDefects: vi.fn(async () => []),
}));
vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(async () => [{ id: "w-1", name: "Lupita González" }]),
}));

// next/navigation's notFound() throws in production to halt rendering and show
// the not-found boundary; mock it so the test can assert it was invoked for an
// unknown lot code (and so it short-circuits like the real control flow).
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

// Stub the section islands so the test asserts the PAGE's job: the dossier
// chrome wrapping the scoresheet + cup-to-cause, with the lot it resolved.
vi.mock("@/components/sections/qc/cupping-scoresheet", () => ({
  CuppingScoresheet: ({ lotCode }: { lotCode: string }) => (
    <div data-testid="cupping-scoresheet-stub" data-lot={lotCode} />
  ),
}));
vi.mock("@/components/sections/qc/defect-entry-form", () => ({
  DefectEntryForm: () => <div data-testid="defect-entry-stub" />,
}));
vi.mock("@/components/sections/qc/cup-to-cause-panel", () => ({
  CupToCausePanel: () => <div data-testid="cup-to-cause-stub" />,
}));
vi.mock("@/components/sections/qc/qc-hold-banner", () => ({
  QcHoldBanner: () => <div data-testid="qc-hold-banner-stub" />,
}));

import CuppingPage from "@/app/(app)/qc/cup/[lot]/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Restore the default "lot exists" roster for tests that don't override it.
  getQcStatus.mockResolvedValue([
    {
      greenLotCode: "JC-800",
      held: false,
      holdReason: null,
      latestCupScore: null,
      primaryDefects: 0,
      secondaryDefects: 0,
    },
  ]);
});

describe("/qc/cup/[lot] page (smoke)", () => {
  it("retrofits the cupping cockpit into the shared <DossierShell>", async () => {
    const ui = await CuppingPage({
      params: Promise.resolve({ lot: "JC-800" }),
    });
    render(ui);

    // The dossier shell wraps the cockpit with a localized eyebrow + back link
    // — chrome shared across all 7 dossiers. The cup view is a facet of a lot,
    // so it uses kind="lot"; the "Catación" eyebrow distinguishes it.
    expect(screen.getByTestId("dossier-lot")).toBeInTheDocument();
    expect(screen.getByText("Catación")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /todo el control de calidad/i }),
    ).toHaveAttribute("href", "/qc");

    // The data is unchanged: the scoresheet renders for the resolved lot.
    const scoresheet = screen.getByTestId("cupping-scoresheet-stub");
    expect(scoresheet).toHaveAttribute("data-lot", "JC-800");
    expect(screen.getByTestId("cup-to-cause-stub")).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("decodes a URL-encoded lot code before passing it to the sections", async () => {
    const ui = await CuppingPage({
      params: Promise.resolve({ lot: "JC%2D800" }),
    });
    render(ui);

    expect(screen.getByTestId("cupping-scoresheet-stub")).toHaveAttribute(
      "data-lot",
      "JC-800",
    );
  });

  it("404s for an unknown lot code instead of rendering a fabricated scoresheet", async () => {
    // No v_qc_status row matches the requested code: there is no cuppable lot,
    // so the page must invoke notFound() rather than compose a scoresheet for a
    // lot that does not exist (review finding: qc-cup-notfound).
    getQcStatus.mockResolvedValue([]);

    await expect(
      CuppingPage({ params: Promise.resolve({ lot: "JC-999" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
