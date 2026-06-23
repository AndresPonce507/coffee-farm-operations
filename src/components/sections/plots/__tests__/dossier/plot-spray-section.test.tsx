import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlotSpraySection } from "@/components/sections/plots/dossier/plot-spray-section";
import type { PlotPhiStatus, SprayLogEntry } from "@/lib/types";

const phi: PlotPhiStatus[] = [
  {
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    product: "Caldo bordelés",
    activeIngredient: "Cobre",
    appliedAt: "2026-06-08",
    phiClearsOn: "2026-06-22",
    reiClearsAt: "2026-06-09",
    phiActive: true,
    reiActive: false,
  },
];

const sprays: SprayLogEntry[] = [
  {
    id: 11,
    plotId: "p-tizingal-alto",
    plotName: "Tizingal Alto",
    product: "Caldo bordelés",
    activeIngredient: "Cobre",
    phiDays: 14,
    reiHours: 24,
    appliedAt: "2026-06-08",
    workerId: "w-marco",
    workerName: "Marco Pérez",
  },
];

describe("PlotSpraySection", () => {
  it("shows the active PHI block and links each applicator → worker dossier", () => {
    render(<PlotSpraySection phi={phi} sprays={sprays} />);

    expect(screen.getByTestId("section-sprays")).toBeInTheDocument();
    // PHI active → harvest-block surfaced.
    expect(screen.getByText(/Caldo bordel/)).toBeInTheDocument();

    const applicator = screen.getByText("Marco Pérez").closest("a");
    expect(applicator).toHaveAttribute("href", "/workers/w-marco");
  });

  it("applicator link carries focus-visible ring classes for keyboard accessibility", () => {
    render(<PlotSpraySection phi={phi} sprays={sprays} />);
    const applicator = screen.getByText("Marco Pérez").closest("a");
    expect(applicator).toHaveClass("focus-visible:ring-2");
    expect(applicator).toHaveClass("focus-visible:outline-none");
    expect(applicator).toHaveClass("rounded-md");
  });

  it("clear-PHI message says 'parcela' not 'lote' to avoid coffee-lot entity collision", () => {
    // phi=[] means no active hold but sprays exist → renders the "free to harvest" card.
    render(<PlotSpraySection phi={[]} sprays={sprays} />);
    expect(screen.getByText(/la parcela está libre para cosechar/i)).toBeInTheDocument();
    expect(screen.queryByText(/el lote está libre/i)).not.toBeInTheDocument();
  });

  it("renders the empty state when there is no spray history", () => {
    render(<PlotSpraySection phi={[]} sprays={[]} />);
    expect(screen.getByTestId("section-sprays")).toBeInTheDocument();
    expect(screen.getByText(/Sin aplicaciones/i)).toBeInTheDocument();
  });
});
