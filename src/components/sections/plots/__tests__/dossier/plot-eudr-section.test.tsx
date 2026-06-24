import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotEudrSection } from "@/components/sections/plots/dossier/plot-eudr-section";
import type { PlotOriginStatus } from "@/lib/types";

const status: PlotOriginStatus = {
  plotId: "p-tizingal-alto",
  plotName: "Tizingal Alto",
  establishedYear: 2014,
  centroid: [-82.63, 8.77],
  geolocated: true,
  deforestationFree: true,
  declBasis: "established-pre-cutoff",
  feedsLots: ["JC-564", "JC-565"],
};

describe("PlotEudrSection", () => {
  it("shows the plot's EUDR facts and links each fed green lot → its dossier", () => {
    render(<PlotEudrSection status={status} />);

    expect(screen.getByTestId("section-eudr")).toBeInTheDocument();

    const lot1 = screen.getByRole("link", { name: /JC-564/ });
    expect(lot1).toHaveAttribute("href", "/lots/JC-564#eudr");
    const lot2 = screen.getByRole("link", { name: /JC-565/ });
    expect(lot2).toHaveAttribute("href", "/lots/JC-565#eudr");
  });

  it("renders the honest empty state when the plot feeds no green lot", () => {
    render(<PlotEudrSection status={null} />);
    expect(screen.getByTestId("section-eudr")).toBeInTheDocument();
    expect(screen.getByText(/Doesn't feed any green lot|no origin/i)).toBeInTheDocument();
  });
});
