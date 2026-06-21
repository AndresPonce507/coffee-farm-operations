import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PasadaTimeline } from "@/components/sections/planning/pasada-timeline";
import type { PasadaPlan } from "@/lib/types";

afterEach(cleanup);

const plans: PasadaPlan[] = [
  {
    id: 1,
    plotId: "p-cuesta-piedra",
    plotName: "Cuesta de Piedra",
    variety: "Catuaí",
    altitudeMasl: 1360,
    season: "2026",
    pasadaNumber: 1,
    predictedReadyDate: "2026-04-01",
    ripenessTarget: "high",
    status: "planned",
    reason: null,
    firedTaskId: "t-1",
  },
  {
    id: 2,
    plotId: "p-las-lagunas",
    plotName: "Las Lagunas",
    variety: "Geisha",
    altitudeMasl: 1700,
    season: "2026",
    pasadaNumber: 1,
    predictedReadyDate: "2026-04-18",
    ripenessTarget: "medium",
    status: "planned",
    reason: "rain front",
    firedTaskId: "t-2",
  },
];

describe("PasadaTimeline (render/smoke)", () => {
  it("renders a row per scheduled pasada with plot + altitude (staggered)", () => {
    render(<PasadaTimeline plans={plans} />);
    expect(screen.getByText("Cuesta de Piedra")).toBeInTheDocument();
    expect(screen.getByText("Las Lagunas")).toBeInTheDocument();
    // the higher plot's altitude is shown so the stagger is legible.
    expect(screen.getByText(/1,?700/)).toBeInTheDocument();
  });

  it("orders the timeline by predicted date (lower/earlier plot first)", () => {
    render(<PasadaTimeline plans={plans} />);
    const items = screen.getAllByTestId(/^pasada-/);
    expect(items[0]).toHaveTextContent("Cuesta de Piedra");
    expect(items[1]).toHaveTextContent("Las Lagunas");
  });

  it("shows a re-plan reason chip when a pass was re-planned around rain", () => {
    render(<PasadaTimeline plans={plans} />);
    expect(screen.getByText(/rain front/i)).toBeInTheDocument();
  });

  it("renders an empty state when nothing is scheduled", () => {
    render(<PasadaTimeline plans={[]} />);
    expect(screen.getByTestId("pasada-empty")).toBeInTheDocument();
  });
});
