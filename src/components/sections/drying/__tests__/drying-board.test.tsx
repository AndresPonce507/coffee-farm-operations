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

  it("DISABLES the advance-to-mill button on a blocked lot with the gate reason in the title", () => {
    render(<DryingBoard lots={[restingLot]} />);
    const card = screen.getByTestId("drying-lot-card");
    const btn = within(card).getByRole("button", { name: /Mill — locked/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/Blocked by the reposo gate/i));
  });

  it("ENABLES the advance-to-mill button on a rest-stable lot", () => {
    render(<DryingBoard lots={[readyLot]} />);
    const btn = screen.getByRole("button", { name: /Advance to mill/i });
    expect(btn).not.toBeDisabled();
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
