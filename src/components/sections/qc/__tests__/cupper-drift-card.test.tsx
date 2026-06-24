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
      screen.getByRole("heading", { name: /cupper drift calibration/i }),
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
    expect(screen.getByText(/no calibration sessions yet/i)).toBeInTheDocument();
  });

  it("renders the human-readable cupper name as the primary identity when a name map is supplied", () => {
    const nameById = new Map([
      ["w-cup-2", "Eduardo Pérez"],
      ["w-cup-1", "Tomás Atencio"],
    ]);
    render(<CupperDriftCard drift={DRIFT} nameById={nameById} />);
    // the calibration-bias evidence must label each cupper by NAME, not an opaque code.
    expect(screen.getByText("Eduardo Pérez")).toBeInTheDocument();
    expect(screen.getByText("Tomás Atencio")).toBeInTheDocument();
  });

  it("falls back to the raw cupper id when no name is mapped", () => {
    const nameById = new Map([["w-cup-1", "Tomás Atencio"]]);
    render(<CupperDriftCard drift={DRIFT} nameById={nameById} />);
    // w-cup-2 is unmapped → the raw id stays visible so nothing is silently dropped.
    expect(screen.getAllByText("w-cup-2").length).toBeGreaterThan(0);
    // the mapped one resolves to its name.
    expect(screen.getByText("Tomás Atencio")).toBeInTheDocument();
  });

  it("renders the raw id (no crash) when no name map is supplied at all", () => {
    render(<CupperDriftCard drift={DRIFT} />);
    expect(screen.getAllByText("w-cup-2").length).toBeGreaterThan(0);
  });
});
