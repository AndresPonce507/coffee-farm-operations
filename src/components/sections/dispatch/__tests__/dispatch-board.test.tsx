import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CrewRosterMember } from "@/lib/db/people";
import type { DispatchCard } from "@/lib/types";

const getDispatchToday = vi.fn();
const getCrewRoster = vi.fn();

vi.mock("@/lib/db/dispatch", () => ({
  getDispatchToday: () => getDispatchToday(),
}));
vi.mock("@/lib/db/people", () => ({
  getCrewRoster: () => getCrewRoster(),
}));
// the board renders client islands that import the route actions — stub the action module.
vi.mock("@/app/(app)/dispatch/actions", () => ({
  generateDispatchAction: vi.fn(),
  markDispatchSentAction: vi.fn(),
  recordDispatchAckAction: vi.fn(),
  DISPATCH_IDLE: { status: "idle" },
}));

import { DispatchBoard } from "@/components/sections/dispatch/dispatch-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const roster: CrewRosterMember[] = [
  {
    workerId: "w-03",
    name: "Eduardo Pérez",
    role: "Picker",
    crewName: "Crew Norte",
    crewId: "crew-norte",
    attendance: "present",
    preferredName: null,
    comarcaOrigin: "Ngäbe-Buglé",
    languages: ["es", "ngäbere"],
    rehireEligible: true,
  },
  {
    workerId: "w-05",
    name: "Tomás Atencio",
    role: "Picker",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    attendance: "present",
    preferredName: null,
    comarcaOrigin: null,
    languages: ["es"],
    rehireEligible: true,
  },
];

const norteCard: DispatchCard = {
  id: 1,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "draft",
  sentChannel: null,
  readinessThreshold: 0.5,
  idempotencyKey: "disp-1",
  plotCount: 1,
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
  ],
};

describe("DispatchBoard (async Server Component render)", () => {
  it("renders a column per crew and the active dispatch card", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([norteCard]);

    render(await DispatchBoard());

    // both crews appear (one with a drafted card, one awaiting a draft).
    expect(screen.getAllByText(/Crew Norte/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Crew Tizingal/).length).toBeGreaterThan(0);
    // the drafted crew shows its plot.
    expect(screen.getAllByText(/Norte Bajo/).length).toBeGreaterThan(0);
  });

  it("offers a generate affordance for a crew with no dispatch yet", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([]); // no dispatches yet

    render(await DispatchBoard());
    // a generate button exists for the undrafted crews.
    expect(
      screen.getAllByRole("button", { name: /generate|dispatch/i }).length,
    ).toBeGreaterThan(0);
  });

  it("shows a headline strip summarising crews / drafted / sent", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([norteCard]);

    render(await DispatchBoard());
    // the summary surfaces the crew count.
    expect(screen.getByTestId("dispatch-summary")).toBeInTheDocument();
  });
});
