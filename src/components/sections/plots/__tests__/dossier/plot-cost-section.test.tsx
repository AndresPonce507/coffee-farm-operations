import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotCostSection } from "@/components/sections/plots/dossier/plot-cost-section";
import type { LotCost } from "@/lib/types";

describe("PlotCostSection", () => {
  it("shows cost-per-kg and DRILLS the computed value to its source ledger", () => {
    const cost: LotCost = { code: "p-tizingal-alto", costPerKgGreen: 4.25 };
    render(<PlotCostSection cost={cost} plotId="p-tizingal-alto" />);

    expect(screen.getByTestId("section-cost")).toBeInTheDocument();
    expect(screen.getByText(/4\.25/)).toBeInTheDocument();

    // Smart-bar: a computed value drills to the editable source records.
    // The plot dossier section id is "cost" — anchor must match the real DOM id.
    const drill = screen.getByRole("link");
    expect(drill).toHaveAttribute("href", "/plots/p-tizingal-alto#cost");
  });

  it("shows an honest em-dash (never a fabricated 0) when green-kg is undeclared", () => {
    const cost: LotCost = { code: "p-tizingal-alto", costPerKgGreen: null };
    render(<PlotCostSection cost={cost} plotId="p-tizingal-alto" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
