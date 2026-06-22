import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DryingBoard } from "@/components/sections/drying/drying-board";
import type { DryingLot } from "@/lib/types";

const restingLot: DryingLot = {
  lotCode: "JC-571",
  variety: "Geisha",
  currentKg: 60,
  stationId: "st-bed-1",
  stationName: "African Bed 1",
  reposo: {
    lotCode: "JC-571",
    latestMoisture: 11.9,
    readingCount: 3,
    moistureStable: false,
    dryingStartedAt: "2026-06-14T08:00:00Z",
    restDaysElapsed: 6.2,
    restMet: true,
    ready: false,
    reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
  },
  curve: [
    { lotCode: "JC-571", moisturePct: 14, occurredAt: "2026-06-15T08:00:00Z" },
    { lotCode: "JC-571", moisturePct: 11.9, occurredAt: "2026-06-19T08:00:00Z" },
  ],
};

const readyLot: DryingLot = {
  ...restingLot,
  lotCode: "JC-572",
  stationName: "Parabolic Tunnel 1",
  reposo: {
    ...restingLot.reposo,
    lotCode: "JC-572",
    latestMoisture: 11.0,
    moistureStable: true,
    ready: true,
    reason: "rest-stable — clear to mill",
  },
  curve: [
    { lotCode: "JC-572", moisturePct: 11.3, occurredAt: "2026-06-17T08:00:00Z" },
    { lotCode: "JC-572", moisturePct: 11.0, occurredAt: "2026-06-19T08:00:00Z" },
  ],
};

describe("DryingBoard (smoke)", () => {
  it("renders a card per resting lot with its code, station, and reposo chip", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    expect(screen.getByText("Resting lots · the reposo gate")).toBeInTheDocument();
    const cards = screen.getAllByTestId("drying-lot-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("JC-571")).toBeInTheDocument();
    expect(screen.getByText("African Bed 1")).toBeInTheDocument();
  });

  it("links each lot's code to its /lots/[code] dossier (entity-bearing row → dossier)", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    const link = screen.getByRole("link", { name: /Abrir lot JC-571/i });
    expect(link).toHaveAttribute("href", "/lots/JC-571");
    expect(link).toHaveTextContent("JC-571");
    // The other lot's code is also a dossier link.
    expect(
      screen.getByRole("link", { name: /Abrir lot JC-572/i }),
    ).toHaveAttribute("href", "/lots/JC-572");
  });

  it("DISABLES the advance-to-mill button on a blocked lot with the gate reason in the title", () => {
    render(<DryingBoard lots={[restingLot]} />);
    const card = screen.getByTestId("drying-lot-card");
    const btn = within(card).getByRole("button", { name: /Mill — locked/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/Blocked by the reposo gate/i));
  });

  it("renders the rest-stable advance affordance as a real link to /processing (not a dead button)", () => {
    render(<DryingBoard lots={[readyLot]} />);
    const card = screen.getByTestId("drying-lot-card");
    // The ready affordance must be an honest, navigable control — a link to the
    // Processing surface where AdvanceStageControl performs the real advance —
    // never an enabled primary CTA with no handler. It carries a per-lot
    // accessible name so multiple advance links on the board are distinguishable.
    const advance = within(card).getByRole("link", {
      name: /Advance lot JC-572 to milling/i,
    });
    expect(advance).toHaveAttribute("href", "/processing");
    expect(advance).toHaveTextContent(/Advance to mill/i);
    // And there must be NO inert advance button on the ready card.
    expect(
      within(card).queryByRole("button", { name: /Advance to mill/i }),
    ).not.toBeInTheDocument();
  });

  it("summarizes how many lots are clear vs resting in the header", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    expect(screen.getByText(/1 clear to mill/)).toBeInTheDocument();
    expect(screen.getByText(/1 resting/)).toBeInTheDocument();
  });

  it("renders an empty state with no resting lots", () => {
    render(<DryingBoard lots={[]} />);
    expect(screen.getByText(/No lots resting yet/i)).toBeInTheDocument();
  });
});
