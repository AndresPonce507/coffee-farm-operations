import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LotEudrDossier } from "@/lib/types";

import { EudrDossier } from "@/components/sections/eudr/eudr-dossier";

afterEach(cleanup);

const compliant: LotEudrDossier = {
  code: "JC-701",
  status: "compliant",
  originPlots: [
    {
      plotId: "p-baru-vista",
      plotName: "Barú Vista",
      establishedYear: 2015,
      centroid: [-82.633982, 8.777835],
      geolocated: true,
      deforestationFree: true,
      declBasis: "established-pre-cutoff",
    },
    {
      plotId: "p-talamanca",
      plotName: "Talamanca",
      establishedYear: 2016,
      centroid: [-82.627618, 8.777835],
      geolocated: true,
      deforestationFree: true,
      declBasis: "satellite-monitoring",
    },
  ],
};

const noOrigin: LotEudrDossier = {
  code: "JC-711",
  status: "no-origin",
  originPlots: [],
};

describe("EudrDossier", () => {
  it("renders the verdict badge and one row per plot of origin with its facts", () => {
    render(<EudrDossier dossier={compliant} />);

    expect(screen.getByTestId("eudr-badge-compliant")).toBeInTheDocument();
    const list = screen.getByTestId("eudr-origin-plots");
    expect(within(list).getByText("Barú Vista")).toBeInTheDocument();
    expect(within(list).getByText("Talamanca")).toBeInTheDocument();

    // The geolocation fact shows the centroid coords (lat, lng) for a located plot.
    const baru = screen.getByTestId("eudr-origin-p-baru-vista");
    expect(within(baru).getByText(/8\.7778, -82\.6340/)).toBeInTheDocument();
    // The declaration fact carries the basis.
    expect(within(baru).getByText(/established-pre-cutoff/)).toBeInTheDocument();
  });

  it("links each origin-plot name to its /plots/[id] dossier (J4: cosmetic row → dossier link)", () => {
    render(<EudrDossier dossier={compliant} />);

    const baru = screen.getByText("Barú Vista").closest("a");
    expect(baru).toHaveAttribute("href", "/plots/p-baru-vista");

    const talamanca = screen.getByText("Talamanca").closest("a");
    expect(talamanca).toHaveAttribute("href", "/plots/p-talamanca");
  });

  it("links the plot name even on an undeclared/ungeolocated origin row", () => {
    const incomplete: LotEudrDossier = {
      code: "JC-721",
      status: "incomplete",
      originPlots: [
        {
          plotId: "p-mystery",
          plotName: "Mystery",
          establishedYear: 2019,
          centroid: null,
          geolocated: false,
          deforestationFree: false,
          declBasis: null,
        },
      ],
    };
    render(<EudrDossier dossier={incomplete} />);
    expect(screen.getByText("Mystery").closest("a")).toHaveAttribute(
      "href",
      "/plots/p-mystery",
    );
  });

  it("shows the honest 'origin cannot be substantiated' state for a no-origin lot (no fabricated tick)", () => {
    render(<EudrDossier dossier={noOrigin} />);
    expect(screen.getByTestId("eudr-badge-no-origin")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-no-origin")).toBeInTheDocument();
    expect(screen.queryByTestId("eudr-origin-plots")).not.toBeInTheDocument();
  });

  it("flags an ungeolocated / undeclared plot as failing (red cross, not a pass)", () => {
    const incomplete: LotEudrDossier = {
      code: "JC-721",
      status: "incomplete",
      originPlots: [
        {
          plotId: "p-mystery",
          plotName: "Mystery",
          establishedYear: 2019,
          centroid: null,
          geolocated: false,
          deforestationFree: false,
          declBasis: null,
        },
      ],
    };
    render(<EudrDossier dossier={incomplete} />);
    const row = screen.getByTestId("eudr-origin-p-mystery");
    expect(within(row).getByText("Not geolocated")).toBeInTheDocument();
    expect(within(row).getByText("Undeclared")).toBeInTheDocument();
  });
});
