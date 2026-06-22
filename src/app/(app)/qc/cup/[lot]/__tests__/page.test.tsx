import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page is an async Server Component that awaits, in parallel, the lineage,
// QC status, cupper roster, and defects. Mock the read ports so the page
// composes against seeded data with no Supabase. Behavior is UNCHANGED by the
// retrofit — this page intentionally degrades gracefully (no 404 gate).
vi.mock("@/lib/db/lots", () => ({
  getLotGenealogy: vi.fn(async () => ({ nodes: [], edges: [] })),
}));
vi.mock("@/lib/db/qc", () => ({
  getQcStatus: vi.fn(async () => []),
  getGreenDefects: vi.fn(async () => []),
}));
vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(async () => [{ id: "w-1", name: "Lupita González" }]),
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

afterEach(cleanup);

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
});
