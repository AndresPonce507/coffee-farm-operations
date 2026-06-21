import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CupperDrift } from "@/lib/types";
import { CupperDriftCard } from "@/components/sections/qc/cupper-drift-card";

const DRIFT: CupperDrift[] = [
  { cupperId: "w-cup-2", attribute: "acidity", cupperMean: 10, panelMean: 8, drift: 2, sampleN: 1 },
  { cupperId: "w-cup-1", attribute: "acidity", cupperMean: 7, panelMean: 8, drift: -1, sampleN: 1 },
];

describe("CupperDriftCard (smoke)", () => {
  it("renders the calibration card title", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    expect(
      screen.getByRole("heading", { name: /cupper.?drift/i }),
    ).toBeInTheDocument();
  });

  it("surfaces a positive drift with a signed value", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    // a +2 acidity bias is shown signed (evidence, not a block).
    expect(screen.getAllByText(/^\+2$/).length).toBeGreaterThan(0);
  });

  it("surfaces a negative drift", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    expect(screen.getAllByText(/^−1$/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when no calibration data exists", () => {
    render(<CupperDriftCard drift={[]} />);
    expect(screen.getByText(/no calibration/i)).toBeInTheDocument();
  });
});
