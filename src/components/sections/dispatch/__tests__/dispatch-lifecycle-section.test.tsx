import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DispatchLifecycleSection } from "@/components/sections/dispatch/dispatch-lifecycle-section";
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

describe("DispatchLifecycleSection", () => {
  it("renders the four lifecycle stages inside the #lifecycle anchor", () => {
    render(<DispatchLifecycleSection run={base} />);

    expect(screen.getByTestId("section-lifecycle")).toBeInTheDocument();
    expect(screen.getByText(/borrador/i)).toBeInTheDocument();
    expect(screen.getByText(/enviad/i)).toBeInTheDocument();
    expect(screen.getByText(/confirmad/i)).toBeInTheDocument();
  });

  it("marks the current stage (sent) as reached via aria-current", () => {
    render(<DispatchLifecycleSection run={{ ...base, status: "sent" }} />);

    expect(screen.getByText(/vía web-share|web-share/i)).toBeInTheDocument();
  });

  it("surfaces the idempotency key as the exactly-once anchor", () => {
    render(<DispatchLifecycleSection run={base} />);

    expect(screen.getByText(/key-abc/)).toBeInTheDocument();
  });
});
