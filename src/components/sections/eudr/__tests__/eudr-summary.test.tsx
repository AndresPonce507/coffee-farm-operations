import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LotEudrDossier } from "@/lib/types";

const dossiers: LotEudrDossier[] = [
  {
    code: "JC-701",
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
  },
  { code: "JC-711", status: "incomplete", originPlots: [] },
];

vi.mock("@/lib/db/eudr", () => ({
  getEudrSummary: vi.fn(async (): Promise<LotEudrDossier[]> => dossiers),
}));

import { EudrSummary } from "@/components/sections/eudr/eudr-summary";

afterEach(cleanup);

describe("EudrSummary (smoke)", () => {
  it("renders the portfolio headline + one card per green lot", async () => {
    const ui = await EudrSummary();
    render(ui);

    // 1 of 2 compliant.
    expect(screen.getByText("Export-ready")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-lot-JC-701")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-lot-JC-711")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-badge-compliant")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-badge-incomplete")).toBeInTheDocument();
  });

  it("each lot card links to its dossier on /lots/[code]", async () => {
    const ui = await EudrSummary();
    render(ui);
    expect(screen.getByTestId("eudr-lot-JC-701")).toHaveAttribute(
      "href",
      "/lots/JC-701#eudr",
    );
  });

  it("renders an empty state when there are no green lots", async () => {
    const { getEudrSummary } = await import("@/lib/db/eudr");
    vi.mocked(getEudrSummary).mockResolvedValueOnce([]);
    const ui = await EudrSummary();
    render(ui);
    expect(screen.getByTestId("eudr-empty")).toBeInTheDocument();
  });
});
