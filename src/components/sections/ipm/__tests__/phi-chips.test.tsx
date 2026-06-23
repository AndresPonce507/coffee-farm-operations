import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PhiChips } from "@/components/sections/ipm/phi-chips";
import type { PlotPhiStatus } from "@/lib/types";

/**
 * Render/smoke test for the PHI/REI countdown chips (P2-S12). An active window
 * shows a per-plot chip; a cleared farm shows the safe empty state. The plot name
 * is wired to the plot dossier (was COSMETIC).
 */

afterEach(cleanup);

const phiActive: PlotPhiStatus = {
  plotId: "p-talamanca",
  plotName: "Talamanca",
  product: "Verdadero 600",
  activeIngredient: "imidacloprid",
  appliedAt: "2026-06-20T08:00:00Z",
  phiClearsOn: "2026-07-04",
  reiClearsAt: "2026-06-21T08:00:00Z",
  phiActive: true,
  reiActive: false,
};

const clear: PlotPhiStatus = {
  ...phiActive,
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  phiActive: false,
  reiActive: false,
};

describe("PhiChips (render/smoke)", () => {
  it("renders a chip per plot with an active window", () => {
    render(<PhiChips rows={[phiActive]} />);
    expect(screen.getByTestId("phi-p-talamanca")).toBeInTheDocument();
    expect(screen.getByText("Talamanca")).toBeInTheDocument();
  });

  it("renders the safe empty state when no window is open", () => {
    render(<PhiChips rows={[clear]} />);
    expect(
      screen.getByText(/No active PHI\/REI windows/i),
    ).toBeInTheDocument();
  });

  it("drills the plot name to the dossier sprays section (was COSMETIC)", () => {
    render(<PhiChips rows={[phiActive]} />);
    const link = screen.getByRole("link", { name: /Talamanca/i });
    expect(link).toHaveAttribute("href", "/plots/p-talamanca#sprays");
  });
});
