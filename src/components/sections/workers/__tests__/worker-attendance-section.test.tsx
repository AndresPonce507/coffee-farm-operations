import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkerAttendanceSection } from "@/components/sections/workers/worker-attendance-section";
import type { AttendanceEvent } from "@/lib/db/people";

afterEach(cleanup);

const events: AttendanceEvent[] = [
  {
    eventUid: "ae-1",
    workerId: "w-001",
    crewId: "crew-norte",
    eventKind: "clock-in",
    plotId: "p-tizingal-alto",
    occurredAt: "2026-06-22T11:00:00Z",
    recordedAt: "2026-06-22T11:00:01Z",
    deviceId: "dev-1",
    deviceSeq: 12,
  },
  {
    eventUid: "ae-2",
    workerId: "w-001",
    crewId: "crew-norte",
    eventKind: "rest-day",
    plotId: null,
    occurredAt: "2026-06-21T08:00:00Z",
    recordedAt: "2026-06-21T08:00:01Z",
    deviceId: "dev-1",
    deviceSeq: 11,
  },
];

describe("WorkerAttendanceSection", () => {
  it("renders the timeline events with their localized kind labels", () => {
    render(<WorkerAttendanceSection events={events} chainVerified />);
    const tl = screen.getByTestId("worker-attendance-timeline");
    expect(within(tl).getByText("Entrada")).toBeInTheDocument();
    expect(within(tl).getByText("Día de descanso")).toBeInTheDocument();
  });

  it("links an event's plot to /plots/[id]", () => {
    render(<WorkerAttendanceSection events={events} chainVerified />);
    const tl = screen.getByTestId("worker-attendance-timeline");
    expect(
      within(tl).getByRole("link", { name: /p-tizingal-alto/i }),
    ).toHaveAttribute("href", "/plots/p-tizingal-alto");
  });

  it("shows the chain-verified badge", () => {
    render(<WorkerAttendanceSection events={events} chainVerified />);
    expect(screen.getByTestId("attendance-chain")).toHaveTextContent(
      "Cadena verificada",
    );
  });

  it("renders the empty state with no events", () => {
    render(<WorkerAttendanceSection events={[]} />);
    expect(
      screen.getByText("Sin eventos de asistencia todavía"),
    ).toBeInTheDocument();
  });
});
