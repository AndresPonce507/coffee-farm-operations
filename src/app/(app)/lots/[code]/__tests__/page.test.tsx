import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LotEudrDossier, LotGenealogy } from "@/lib/types";

// The page is an async Server Component that awaits getLotGenealogy(code).
// Mock the read port so the page composes against a seeded lineage with no Supabase.
const genealogy: LotGenealogy = {
  nodes: [
    {
      code: "JC-100",
      stage: "cherry",
      variety: "Geisha",
      originKg: 1000,
      currentKg: 1000,
      isSingleOrigin: true,
      mintedAt: "2026-05-01",
    },
    {
      code: "JC-100W",
      stage: "parchment",
      variety: "Geisha",
      originKg: 600,
      currentKg: 450,
      isSingleOrigin: true,
      mintedAt: "2026-05-05",
    },
    {
      code: "JC-100N",
      stage: "drying",
      variety: "Geisha",
      originKg: 400,
      currentKg: 280,
      isSingleOrigin: true,
      mintedAt: "2026-05-05",
    },
    {
      code: "JC-200",
      stage: "green",
      variety: "Geisha",
      originKg: 200,
      currentKg: 200,
      isSingleOrigin: false,
      mintedAt: "2026-05-20",
    },
  ],
  edges: [
    { parentCode: "JC-100", childCode: "JC-100W", kind: "split", kg: 600 },
    { parentCode: "JC-100", childCode: "JC-100N", kind: "split", kg: 400 },
    { parentCode: "JC-100W", childCode: "JC-200", kind: "blend", kg: 120 },
    { parentCode: "JC-100N", childCode: "JC-200", kind: "blend", kg: 80 },
  ],
};

vi.mock("@/lib/db/lots", () => ({
  getLotGenealogy: vi.fn(async (): Promise<LotGenealogy> => genealogy),
}));

// next/navigation's notFound() throws a sentinel that the router catches to
// render the 404 page. Mock it so the test can assert the page short-circuits.
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

// The page now also reads the cost_entry ledger for the #cost-entries section;
// mock getCostBreakdown so the test has no Supabase dep.
vi.mock("@/lib/db/cogs", () => ({
  getCostBreakdown: vi.fn(async () => []),
}));

// The page also awaits the S8 EUDR dossier; mock that port too (no Supabase).
vi.mock("@/lib/db/eudr", () => ({
  getLotEudrDossier: vi.fn(
    async (code: string): Promise<LotEudrDossier> => ({
      code,
      status: "compliant",
      originPlots: [
        {
          plotId: "p-baru-vista",
          plotName: "Barú Vista",
          establishedYear: 2015,
          centroid: [-82.63, 8.77],
          geolocated: true,
          deforestationFree: true,
          declBasis: "established-pre-cutoff",
        },
      ],
    }),
  ),
}));

import LotGenealogyPage from "@/app/(app)/lots/[code]/page";
import { getLotGenealogy } from "@/lib/db/lots";
import { notFound } from "next/navigation";

describe("/lots/[code] page (smoke)", () => {
  it("awaits the seeded lot code and renders the farm-to-bag lineage graph", async () => {
    const ui = await LotGenealogyPage({
      params: Promise.resolve({ code: "JC-200" }),
    });
    render(ui);

    // The read port was called with the route's lot code.
    expect(getLotGenealogy).toHaveBeenCalledWith("JC-200");

    // Retrofit: the page now wraps its content in the shared <DossierShell>
    // (data-dossier="lot") with a localized eyebrow + back link, so all 7
    // dossiers share chrome. The data + sections are unchanged.
    expect(screen.getByTestId("dossier-lot")).toBeInTheDocument();
    expect(screen.getByText("Lote")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /todos los lotes/i }),
    ).toHaveAttribute("href", "/lots");

    // The header names the lot, and the genealogy figure renders.
    expect(
      screen.getByRole("heading", { level: 1, name: /JC-200/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /genealogy/i })).toBeInTheDocument();
    // The lineage's root intake is visible in the rendered graph.
    expect(screen.getAllByText("JC-100").length).toBeGreaterThan(0);

    // S8: the EUDR due-diligence dossier renders below the lineage (green lot).
    expect(screen.getByTestId("eudr-badge-compliant")).toBeInTheDocument();
    expect(screen.getByText("Barú Vista")).toBeInTheDocument();

    // ANCHOR GUARD: the #cost-entries section must always render on the lot dossier
    // so the provenance drill from CostLotCard (anchor="cost-entries") scrolls to a
    // real DOM node and never silently lands on a dead fragment.
    expect(screen.getByTestId("section-cost-entries")).toBeInTheDocument();
  });

  it("does NOT render the EUDR dossier for a non-green lot (it's not yet an export lot)", async () => {
    const { getLotEudrDossier } = await import("@/lib/db/eudr");
    vi.mocked(getLotEudrDossier).mockClear();

    // JC-100 is a cherry-stage node in the mocked lineage → no dossier section.
    const ui = await LotGenealogyPage({
      params: Promise.resolve({ code: "JC-100" }),
    });
    render(ui);

    expect(screen.queryByTestId("eudr-badge-compliant")).not.toBeInTheDocument();
    expect(screen.queryByTestId("eudr-no-origin")).not.toBeInTheDocument();
    // the dossier port is never even called for a non-green lot (no wasted fetch).
    expect(getLotEudrDossier).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent lot (empty graph) instead of fabricating a page", async () => {
    vi.mocked(notFound).mockClear();
    // A code with no nodes: the ⌘K palette can route to /lots/JC-999 even when
    // no such lot exists — that must 404, not render an empty traceability page.
    vi.mocked(getLotGenealogy).mockResolvedValueOnce({ nodes: [], edges: [] });

    await expect(
      LotGenealogyPage({ params: Promise.resolve({ code: "JC-999" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
