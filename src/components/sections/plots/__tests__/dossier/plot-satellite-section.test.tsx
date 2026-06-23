import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotSatelliteSection } from "@/components/sections/plots/dossier/plot-satellite-section";
import type { PlotVegetation } from "@/lib/types";

const vegetation: PlotVegetation = {
  plotId: "p-tizingal-alto",
  plotName: "Tizingal Alto",
  variety: "Geisha",
  altitudeMasl: 1650,
  value: 0.74,
  indexKind: "ndvi",
  confidence: "high",
  basis: "optical",
  cloudPct: 8,
  observedAt: "2026-06-09",
};

describe("PlotSatelliteSection", () => {
  it("surfaces the fused index value and the HONEST confidence badge", () => {
    render(<PlotSatelliteSection vegetation={vegetation} />);

    expect(screen.getByTestId("section-vegetation")).toBeInTheDocument();
    expect(screen.getByText(/0\.74/)).toBeInTheDocument();
    // Confidence is always surfaced (the differentiator).
    expect(screen.getByText(/alta|high/i)).toBeInTheDocument();
  });

  it("renders the honest 'no signal' empty when there is no vegetation read", () => {
    render(<PlotSatelliteSection vegetation={null} />);
    expect(screen.getByTestId("section-vegetation")).toBeInTheDocument();
    expect(screen.getByText(/Sin lectura|Sin señal/i)).toBeInTheDocument();
  });
});
