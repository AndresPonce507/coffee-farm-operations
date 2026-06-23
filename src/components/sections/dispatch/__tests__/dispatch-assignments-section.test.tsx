import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DispatchAssignmentsSection } from "@/components/sections/dispatch/dispatch-assignments-section";
import type { CrewRosterMember } from "@/lib/db/people";
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
  plots: [
    {
      id: 1,
      dispatchRunId: 42,
      plotId: "p-norte-bajo",
      plotName: "Norte Bajo",
      variety: "Catuaí",
      altitudeMasl: 1400,
      taskKind: "picking",
      targetKg: 120,
      ripenessTarget: "high",
      readiness: 0.92,
      ord: 0,
    },
    {
      id: 2,
      dispatchRunId: 42,
      plotId: "p-norte-alto",
      plotName: "Norte Alto",
      variety: "Geisha",
      altitudeMasl: 1650,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "medium",
      readiness: 0.81,
      ord: 1,
    },
  ],
};

const members: CrewRosterMember[] = [
  {
    workerId: "w-06",
    name: "Lucía Morales",
    role: "Picker",
    crewName: "Crew Norte",
    crewId: "crew-norte",
    attendance: "present",
    preferredName: "Lucía",
    comarcaOrigin: "Ngäbe-Buglé",
    languages: ["es", "ngäbere"],
    rehireEligible: true,
  },
];

describe("DispatchAssignmentsSection", () => {
  it("links each plot line to its /plots/[id] dossier", () => {
    render(<DispatchAssignmentsSection run={run} crewMembers={members} />);

    const plotLink = screen.getByRole("link", { name: /parcela p-norte-bajo/i });
    expect(plotLink).toHaveAttribute("href", "/plots/p-norte-bajo");
    expect(
      screen.getByRole("link", { name: /parcela p-norte-alto/i }),
    ).toHaveAttribute("href", "/plots/p-norte-alto");
  });

  it("links each assigned crew member to their /workers/[id] dossier", () => {
    render(<DispatchAssignmentsSection run={run} crewMembers={members} />);

    expect(
      screen.getByRole("link", { name: /trabajador w-06/i }),
    ).toHaveAttribute("href", "/workers/w-06");
  });

  it("shows the empty roster copy when no crew members are assigned", () => {
    render(<DispatchAssignmentsSection run={run} crewMembers={[]} />);

    expect(screen.getByText(/sin cuadrilla|sin trabajadores/i)).toBeInTheDocument();
  });
});
