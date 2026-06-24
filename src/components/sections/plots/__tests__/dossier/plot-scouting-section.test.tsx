import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotScoutingSection } from "@/components/sections/plots/dossier/plot-scouting-section";
import type { IpmThresholdStatus } from "@/lib/types";

const scouting: IpmThresholdStatus[] = [
  {
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    pestKind: "broca",
    incidencePct: 6.2,
    threshold: 5,
    recommend: true,
    observedAt: "2026-06-10",
    firedTaskId: "t-99",
  },
];

describe("PlotScoutingSection", () => {
  it("renders the recommend/hold call for each scouted pest", () => {
    render(<PlotScoutingSection scouting={scouting} />);

    expect(screen.getByTestId("section-scouting")).toBeInTheDocument();
    expect(screen.getByText(/broca/i)).toBeInTheDocument();
    // Above threshold → recommends control.
    expect(screen.getByText(/recomienda|control/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no scouting reads", () => {
    render(<PlotScoutingSection scouting={[]} />);
    expect(screen.getByTestId("section-scouting")).toBeInTheDocument();
    expect(screen.getByText(/No scouting recorded/i)).toBeInTheDocument();
  });
});
