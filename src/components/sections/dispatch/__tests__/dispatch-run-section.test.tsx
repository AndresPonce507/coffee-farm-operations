import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DispatchRunSection } from "@/components/sections/dispatch/dispatch-run-section";
import type { DispatchCard } from "@/lib/types";

afterEach(cleanup);

const run: DispatchCard = {
  id: 42,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "sent",
  sentChannel: "web-share",
  readinessThreshold: 0.7,
  idempotencyKey: "key-abc",
  plotCount: 2,
  plots: [],
};

describe("DispatchRunSection", () => {
  it("renders the run header with crew, date and season inside the #the-run anchor", () => {
    render(<DispatchRunSection run={run} crewLanguages={["es"]} />);

    expect(screen.getByTestId("section-the-run")).toBeInTheDocument();
    expect(screen.getByText("Crew Norte")).toBeInTheDocument();
    expect(screen.getByText(/2026-06-22/)).toBeInTheDocument();
  });

  it("links the crew name to its /crew/[crewId] dossier (cross-entity link)", () => {
    render(<DispatchRunSection run={run} crewLanguages={["es"]} />);

    const link = screen.getByRole("link", { name: /Crew Norte|crew/i });
    expect(link).toHaveAttribute("href", "/crew/crew-norte");
  });
});
