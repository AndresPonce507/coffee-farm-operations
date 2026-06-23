import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScoutingBoard } from "@/components/sections/ipm/scouting-board";
import type { IpmThresholdStatus } from "@/lib/types";

/**
 * Render/smoke test for the IPM scouting board (P2-S12). A scouting read that
 * crossed the economic threshold shows a clear RECOMMEND-CONTROL state (and the
 * fired task), a below-threshold read shows HOLD — the recommend/hold call is
 * legible, evidence-driven, never a vague alert.
 */

afterEach(cleanup);

const recommend: IpmThresholdStatus = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  pestKind: "broca",
  incidencePct: 8,
  threshold: 5,
  recommend: true,
  observedAt: "2026-06-21T09:00:00Z",
  firedTaskId: "task-1",
};

const hold: IpmThresholdStatus = {
  plotId: "p-talamanca",
  plotName: "Talamanca",
  pestKind: "broca",
  incidencePct: 2,
  threshold: 5,
  recommend: false,
  observedAt: "2026-06-21T09:00:00Z",
  firedTaskId: null,
};

describe("ScoutingBoard (render/smoke)", () => {
  it("renders a card per scouting status with the plot + pest", () => {
    render(<ScoutingBoard rows={[recommend, hold]} />);
    expect(screen.getByText("Cuesta de Piedra")).toBeInTheDocument();
    expect(screen.getAllByText(/broca/i).length).toBeGreaterThan(0);
  });

  it("shows a RECOMMEND-CONTROL state for an above-threshold read", () => {
    render(<ScoutingBoard rows={[recommend]} />);
    const card = screen.getByTestId("scouting-p-cuesta-piedra-broca");
    expect(within(card).getByText(/recommend control/i)).toBeInTheDocument();
    expect(within(card).getByText("8%")).toBeInTheDocument(); // the incidence
  });

  it("shows a HOLD state (no action) for a below-threshold read", () => {
    render(<ScoutingBoard rows={[hold]} />);
    const card = screen.getByTestId("scouting-p-talamanca-broca");
    expect(within(card).getByText(/hold & monitor/i)).toBeInTheDocument();
  });

  it("renders an empty state when no plots have been scouted", () => {
    render(<ScoutingBoard rows={[]} />);
    expect(screen.getByTestId("scouting-empty")).toBeInTheDocument();
  });

  it("wires the plot name to the plot dossier (was COSMETIC)", () => {
    render(<ScoutingBoard rows={[recommend]} />);
    // EntityLink sets aria-label="Abrir plot <id>" — query by that accessible name.
    const link = screen.getByRole("link", { name: /abrir plot p-cuesta-piedra/i });
    expect(link).toHaveAttribute("href", "/plots/p-cuesta-piedra");
  });

  it("links a fired control task to the tasks board", () => {
    render(<ScoutingBoard rows={[recommend]} />);
    const link = screen.getByRole("link", { name: /control task/i });
    expect(link).toHaveAttribute("href", "/tasks");
  });

  it("does not render a task link when nothing fired (below threshold)", () => {
    render(<ScoutingBoard rows={[hold]} />);
    expect(
      screen.queryByRole("link", { name: /control task/i }),
    ).not.toBeInTheDocument();
  });
});
