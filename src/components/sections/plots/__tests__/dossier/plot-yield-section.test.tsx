import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotYieldSection } from "@/components/sections/plots/dossier/plot-yield-section";
import type { PlotYield } from "@/lib/db/dossier/plot";

describe("PlotYieldSection", () => {
  it("shows the season yield rollup and drills harvested-kg to the harvest log", () => {
    const yld: PlotYield = {
      plotId: "p-tizingal-alto",
      expectedYieldKg: 9000,
      harvestedKg: 5400,
      pct: 60,
    };
    render(<PlotYieldSection yield={yld} plotId="p-tizingal-alto" />);

    expect(screen.getByTestId("section-yield")).toBeInTheDocument();
    expect(screen.getByText(/60/)).toBeInTheDocument();

    // Computed total drills to the editable harvest records.
    const drill = screen.getByRole("link");
    expect(drill).toHaveAttribute(
      "href",
      "/plots/p-tizingal-alto#harvests",
    );
  });

  it("shows an em-dash for the ratio when the season target is undeclared", () => {
    const yld: PlotYield = {
      plotId: "p-x",
      expectedYieldKg: 0,
      harvestedKg: 0,
      pct: null,
    };
    render(<PlotYieldSection yield={yld} plotId="p-x" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
