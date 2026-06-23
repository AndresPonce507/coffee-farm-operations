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
    // eudr-lot-<code> is a <span> wrapper around the EntityLink; the inner <a>
    // carries the href to the lot dossier.
    const wrapper = screen.getByTestId("eudr-lot-JC-701");
    const link = wrapper.querySelector("a");
    expect(link).toHaveAttribute("href", "/lots/JC-701#eudr");
  });

  it("lot card wrapper is NOT an anchor — plot EntityLinks must not be nested inside a lot <a>", async () => {
    const ui = await EudrSummary();
    render(ui);
    // The lot code is rendered inside a <span data-testid="eudr-lot-*"> that
    // contains a single EntityLink <a>. The card's outer container must NOT be
    // an <a>, so plot EntityLinks are never nested inside the lot anchor.
    const lotWrapper = screen.getByTestId("eudr-lot-JC-701");
    // Wrapper is a span, not an anchor.
    expect(lotWrapper.tagName).toBe("SPAN");
    const lotAnchor = lotWrapper.querySelector("a");
    expect(lotAnchor).not.toBeNull();
    // The lot anchor must NOT contain any other <a> (plot EntityLinks are siblings,
    // not descendants — nested <a> in <a> is invalid HTML).
    expect(lotAnchor!.querySelector("a")).toBeNull();
  });

  it("renders an empty state when there are no green lots", async () => {
    const { getEudrSummary } = await import("@/lib/db/eudr");
    vi.mocked(getEudrSummary).mockResolvedValueOnce([]);
    const ui = await EudrSummary();
    render(ui);
    expect(screen.getByTestId("eudr-empty")).toBeInTheDocument();
  });

  it("renders per-plot EntityLink anchors (/plots/<id>) for lots with origin plots", async () => {
    const ui = await EudrSummary();
    render(ui);
    // JC-701 has one origin plot (p-baru-vista) — a link to /plots/p-baru-vista must appear.
    const wrapper = screen.getByTestId("eudr-origin-plot-p-baru-vista");
    expect(wrapper).toBeInTheDocument();
    // The EntityLink renders an <a> inside the wrapper span.
    const link = wrapper.querySelector("a");
    expect(link).toHaveAttribute("href", "/plots/p-baru-vista");
    expect(link).toHaveTextContent("Barú Vista");
  });

  it("renders 'No plots of origin traced' for a lot with no origin plots", async () => {
    const ui = await EudrSummary();
    render(ui);
    // JC-711 has no origin plots.
    expect(screen.getByTestId("eudr-no-plots-JC-711")).toBeInTheDocument();
  });
});
