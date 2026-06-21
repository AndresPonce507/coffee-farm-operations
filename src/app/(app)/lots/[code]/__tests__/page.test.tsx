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
    { parentCode: "JC-100", childCode: "JC-200", kind: "process", kg: 200 },
  ],
};

vi.mock("@/lib/db/lots", () => ({
  getLotGenealogy: vi.fn(async (): Promise<LotGenealogy> => genealogy),
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

describe("/lots/[code] page (smoke)", () => {
  it("awaits the seeded lot code and renders the farm-to-bag lineage graph", async () => {
    const ui = await LotGenealogyPage({
      params: Promise.resolve({ code: "JC-200" }),
    });
    render(ui);

    // The read port was called with the route's lot code.
    expect(getLotGenealogy).toHaveBeenCalledWith("JC-200");

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
});
