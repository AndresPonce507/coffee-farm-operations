import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkerProductivitySection } from "@/components/sections/workers/worker-productivity-section";
import type { WeighByPicker } from "@/lib/db/weigh";
import type { WorkerWeigh } from "@/lib/db/dossier/worker";

afterEach(cleanup);

const summary: WeighByPicker = {
  workerId: "w-001",
  name: "Lupita González",
  crewId: "crew-norte",
  lataCount: 7,
  kgToday: 84.5,
  lastWeighAt: "2026-06-22T15:00:00Z",
};

const events: WorkerWeigh[] = [
  {
    eventUid: "we-1",
    plotId: "p-tizingal-alto",
    lotCode: "JC-564",
    kg: 12.3,
    ripeness: "ripe",
    brix: 21,
    geofenceOk: true,
    occurredAt: "2026-06-22T15:00:00Z",
  },
  {
    eventUid: "we-2",
    plotId: "p-baru-vista",
    lotCode: "JC-565",
    kg: 11.8,
    ripeness: "underripe",
    brix: 19,
    geofenceOk: true,
    occurredAt: "2026-06-22T14:30:00Z",
  },
];

describe("WorkerProductivitySection", () => {
  it("renders today's tally and drills to the weigh source", () => {
    render(<WorkerProductivitySection summary={summary} events={events} />);
    expect(screen.getByText("84.5 kg")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    const drill = screen.getByTestId("weigh-today-drill");
    expect(drill).toHaveAttribute("href", "/weigh#weigh-source");
  });

  it("links each weigh event to its plot and its lot", () => {
    render(<WorkerProductivitySection summary={summary} events={events} />);
    const list = screen.getByTestId("worker-weigh-events");

    expect(
      within(list).getByRole("link", { name: /p-tizingal-alto/i }),
    ).toHaveAttribute("href", "/plots/p-tizingal-alto");
    expect(
      within(list).getByRole("link", { name: /JC-564/i }),
    ).toHaveAttribute("href", "/lots/JC-564");
  });

  it("renders the empty state when there is no summary and no events", () => {
    render(<WorkerProductivitySection summary={null} events={[]} />);
    expect(
      screen.getByText("No weigh-ins recorded yet"),
    ).toBeInTheDocument();
  });
});
