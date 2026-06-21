import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DispatchCard } from "@/lib/types";

import { DispatchCardPreview } from "@/components/sections/dispatch/dispatch-card-preview";

afterEach(cleanup);

const baseCard: DispatchCard = {
  id: 1,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "draft",
  sentChannel: null,
  readinessThreshold: 0.5,
  idempotencyKey: "disp-1",
  plotCount: 2,
  plots: [
    {
      id: 10,
      dispatchRunId: 1,
      plotId: "p-norte-1",
      plotName: "Norte Bajo",
      variety: "Catuaí",
      altitudeMasl: 1400,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "high",
      readiness: 0.95,
      ord: 1,
    },
    {
      id: 11,
      dispatchRunId: 1,
      plotId: "p-norte-2",
      plotName: "Norte Medio",
      variety: "Geisha",
      altitudeMasl: 1550,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "medium",
      readiness: 0.6,
      ord: 2,
    },
  ],
};

describe("DispatchCardPreview", () => {
  it("renders the crew name and every plot line", () => {
    render(<DispatchCardPreview card={baseCard} />);
    // names appear both in the visual card AND the mirrored shareable text region
    // (one renderer, two surfaces) — assert presence via getAllByText.
    expect(screen.getAllByText(/Crew Norte/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Norte Bajo/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Norte Medio/).length).toBeGreaterThan(0);
  });

  it("renders an empty-state line when no plots are ready", () => {
    const empty: DispatchCard = { ...baseCard, plotCount: 0, plots: [] };
    render(<DispatchCardPreview card={empty} />);
    // an empty card still names the crew and shows a "none ready" affordance.
    expect(screen.getAllByText(/Crew Norte/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/ninguna|none|no plots|sin parcelas/i).length,
    ).toBeGreaterThan(0);
  });

  it("exposes the shareable text in a copyable region for the share island", () => {
    render(<DispatchCardPreview card={baseCard} />);
    // the rendered plain-text card is present as a region the composer can read.
    const pre = screen.getByTestId("dispatch-card-text");
    expect(within(pre).getByText(/Norte Bajo/)).toBeInTheDocument();
  });

  it("shows the status (draft) on the preview", () => {
    render(<DispatchCardPreview card={baseCard} />);
    expect(screen.getByText(/draft|borrador/i)).toBeInTheDocument();
  });
});
