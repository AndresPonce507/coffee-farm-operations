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

describe("PasadaTimeline — EntityLink navigation", () => {
  it("links the plot name in each pasada row to its /plots/[id] dossier", () => {
    render(<PasadaTimeline plans={plans} />);
    // WCAG 2.5.3: aria-label must contain the visible plot name (not slug).
    // EntityLink renders aria-label="Abrir parcela <plotName>".
    const link1 = screen.getByRole("link", { name: /parcela Cuesta de Piedra/i });
    expect(link1).toHaveAttribute("href", "/plots/p-cuesta-piedra");
    expect(link1).toHaveTextContent("Cuesta de Piedra");

    const link2 = screen.getByRole("link", { name: /parcela Las Lagunas/i });
    expect(link2).toHaveAttribute("href", "/plots/p-las-lagunas");
    expect(link2).toHaveTextContent("Las Lagunas");
  });
});

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

  it("shows an 'on the board' affordance for a pass that fired a task", () => {
    render(<PasadaTimeline plans={[plans[0]]} />);
    expect(screen.getByTestId("pasada-1")).toHaveTextContent(/on the board/i);
  });

  it("omits the fired-task affordance for a pass with no task yet", () => {
    const notFired: PasadaPlan = { ...plans[0], firedTaskId: null };
    render(<PasadaTimeline plans={[notFired]} />);
    expect(screen.getByTestId("pasada-1")).not.toHaveTextContent(/on the board/i);
  });
});
