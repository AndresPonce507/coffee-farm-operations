import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DispatchAckSection } from "@/components/sections/dispatch/dispatch-ack-section";
import type { DispatchCard } from "@/lib/types";

afterEach(cleanup);

const base: DispatchCard = {
  id: 42,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "sent",
  sentChannel: "web-share",
  readinessThreshold: 0.7,
  idempotencyKey: "key-abc",
  plotCount: 0,
  plots: [],
};

describe("DispatchAckSection", () => {
  it("renders the acknowledged state when the crew lead confirmed the card", () => {
    render(<DispatchAckSection run={{ ...base, status: "acknowledged" }} />);

    expect(screen.getByTestId("section-ack")).toBeInTheDocument();
    expect(screen.getByText(/confirmad/i)).toBeInTheDocument();
  });

  it("renders the awaiting-ack state for a sent-but-not-acknowledged run", () => {
    render(<DispatchAckSection run={{ ...base, status: "sent" }} />);

    expect(screen.getByText(/esperando|sin confirmar|enviad/i)).toBeInTheDocument();
  });

  it("notes acknowledgement is evidence-only (untrusted text never drives an action)", () => {
    render(<DispatchAckSection run={{ ...base, status: "acknowledged" }} />);

    expect(screen.getByText(/evidencia/i)).toBeInTheDocument();
  });
});
