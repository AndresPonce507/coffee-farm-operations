import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotIdentitySection } from "@/components/sections/plots/dossier/plot-identity-section";
import type { Plot } from "@/lib/types";

const plot: Plot = {
  id: "p-tizingal-alto",
  name: "Tizingal Alto",
  block: "Bloque A",
  variety: "Geisha",
  areaHa: 2.4,
  altitudeMasl: 1650,
  trees: 4200,
  shadePct: 35,
  establishedYear: 2014,
  status: "watch",
  lastInspected: "2026-06-10",
  expectedYieldKg: 9000,
  harvestedKg: 5400,
};

describe("PlotIdentitySection", () => {
  it("renders the plot identity + geometry facts inside its anchored section", () => {
    render(<PlotIdentitySection plot={plot} />);

    expect(screen.getByTestId("section-identity")).toBeInTheDocument();
    // Geometry facts surface.
    expect(screen.getByText(/Geisha/)).toBeInTheDocument();
    expect(screen.getByText(/2\.4/)).toBeInTheDocument();
    expect(screen.getByText(/1650|1,650/)).toBeInTheDocument();
    expect(screen.getByText(/4200|4,200/)).toBeInTheDocument();
    expect(screen.getByText(/Bloque A/)).toBeInTheDocument();
  });
});
