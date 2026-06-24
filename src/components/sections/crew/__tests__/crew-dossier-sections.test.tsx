import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CrewRosterSection } from "@/components/sections/crew/crew-roster-section";
import { CrewPlotsSection } from "@/components/sections/crew/crew-plots-section";
import { CrewDispatchSection } from "@/components/sections/crew/crew-dispatch-section";
import { CrewProductivitySection } from "@/components/sections/crew/crew-productivity-section";
import type {
  CrewAssignedPlot,
  CrewProductivity,
} from "@/lib/db/dossier/crew";
import type { CrewRosterMember } from "@/lib/db/people";
import type { DispatchCard } from "@/lib/types";

afterEach(cleanup);

const members: CrewRosterMember[] = [
  {
    workerId: "w-06",
    name: "Lucía Morales",
    role: "Picker",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    attendance: "present",
    preferredName: "Lucía",
    comarcaOrigin: "Ngäbe-Buglé",
    languages: ["es", "ngäbere"],
    rehireEligible: true,
  },
  {
    workerId: "w-07",
    name: "Carlos Beker",
    role: "Picker",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    attendance: "rest-day",
    preferredName: null,
    comarcaOrigin: null,
    languages: ["es"],
    rehireEligible: false,
  },
];

const history: DispatchCard[] = [
  {
    id: 42,
    crewId: "crew-tizingal",
    crewName: "Crew Tizingal",
    dispatchDate: "2026-06-20",
    season: "2026",
    status: "sent",
    sentChannel: "web-share",
    readinessThreshold: 0.6,
    idempotencyKey: null,
    plotCount: 1,
    plots: [
      {
        id: 1,
        dispatchRunId: 42,
        plotId: "p-norte-bajo",
        plotName: "Norte Bajo",
        variety: "Catuaí",
        altitudeMasl: 1400,
        taskKind: "picking",
        targetKg: null,
        ripenessTarget: "ripe",
        readiness: 0.7,
        ord: 1,
      },
    ],
  },
];

const plots: CrewAssignedPlot[] = [
  {
    plotId: "p-norte-bajo",
    plotName: "Norte Bajo",
    variety: "Catuaí",
    altitudeMasl: 1400,
    runCount: 2,
    lastDispatchDate: "2026-06-20",
  },
];

const productivity: CrewProductivity = {
  pickers: [
    {
      workerId: "w-06",
      name: "Lucía Morales",
      crewId: "crew-tizingal",
      lataCount: 7,
      kgToday: 70,
      lastWeighAt: "2026-06-22T11:00:00Z",
    },
  ],
  totalKg: 70,
  totalLatas: 7,
  pickerCount: 1,
};

describe("CrewRosterSection", () => {
  it("renders each member name as a link to their /workers/[id] dossier", () => {
    render(<CrewRosterSection members={members} />);
    // EntityLink uses preferredName (or full name) → "Open worker Lucía"
    const lucia = screen.getByRole("link", { name: /worker Lucía/i });
    expect(lucia).toHaveAttribute("href", "/workers/w-06");
    expect(within(lucia).getByText("Lucía")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /worker Carlos Beker/i }),
    ).toHaveAttribute("href", "/workers/w-07");
  });

  it("renders the empty state when the crew has no members", () => {
    render(<CrewRosterSection members={[]} />);
    expect(
      screen.getByText(/no members in this crew yet/i),
    ).toBeInTheDocument();
  });
});

describe("CrewPlotsSection", () => {
  it("renders each plot as a link to its /plots/[id] dossier", () => {
    render(<CrewPlotsSection plots={plots} />);
    // EntityLink uses the human-readable plotName as aria-label → "Open plot Norte Bajo"
    const link = screen.getByRole("link", { name: /plot Norte Bajo/i });
    expect(link).toHaveAttribute("href", "/plots/p-norte-bajo");
    expect(within(link).getByText("Norte Bajo")).toBeInTheDocument();
  });

  it("uses 'plot' (not 'lot') in the empty-state copy to avoid collision with the coffee-lot entity", () => {
    render(<CrewPlotsSection plots={[]} />);
    expect(
      screen.getByText(/hasn’t been dispatched to any plot/i),
    ).toBeInTheDocument();
    // Must NOT say "lot" — that word is reserved for the coffee-lot entity.
    expect(
      screen.queryByText(/any lot\b/i),
    ).not.toBeInTheDocument();
  });

  it("section title uses 'plots' not 'lots' to avoid entity-name collision", () => {
    render(<CrewPlotsSection plots={plots} />);
    expect(screen.getByText(/Assigned plots/i)).toBeInTheDocument();
    expect(screen.queryByText(/Assigned lots/i)).not.toBeInTheDocument();
  });
});

describe("CrewDispatchSection", () => {
  it("links each run to its /dispatch/[id] dossier and each plot line to /plots/[id]", () => {
    render(<CrewDispatchSection history={history} />);
    // Dispatch link: no `name` prop — the visible "Dispatch on <date>" text IS the
    // accessible name (WCAG 2.5.3), so we match it rather than the raw run id.
    expect(
      screen.getByRole("link", { name: /Dispatch on 2026-06-20/i }),
    ).toHaveAttribute("href", "/dispatch/42");
    // Plot link: aria-label uses the human-readable plotName, not the raw plotId.
    expect(
      screen.getByRole("link", { name: /plot Norte Bajo/i }),
    ).toHaveAttribute("href", "/plots/p-norte-bajo");
  });

  it("renders the empty state for a crew with no dispatch history", () => {
    render(<CrewDispatchSection history={[]} />);
    expect(
      screen.getByText(/no dispatches recorded/i),
    ).toBeInTheDocument();
  });

  it("plot pill links meet the 44px glove-friendly touch target (min-h-11)", () => {
    render(<CrewDispatchSection history={history} />);
    const plotLink = screen.getByRole("link", {
      name: /plot Norte Bajo/i,
    });
    // The link element must carry min-h-11 so the tap target reaches >=44px.
    expect(plotLink.className).toMatch(/min-h-11/);
  });

  it("renders plotCount as 'plot/plots' not 'lot/lots' to avoid coffee-lot entity collision", () => {
    render(<CrewDispatchSection history={history} />);
    // history fixture has plotCount: 1 → singular
    expect(screen.getByText(/1 plot\b/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 lot\b/i)).not.toBeInTheDocument();
  });
});

describe("CrewProductivitySection", () => {
  it("links each picker to their /workers/[id] dossier and shows the crew total", () => {
    render(<CrewProductivitySection productivity={productivity} />);
    // EntityLink uses the picker's full name → "Open worker Lucía Morales"
    expect(
      screen.getByRole("link", { name: /worker Lucía Morales/i }),
    ).toHaveAttribute("href", "/workers/w-06");
    expect(screen.getByText("70.0 kg")).toBeInTheDocument();
  });

  it("renders the empty state when the crew has not weighed in today", () => {
    render(
      <CrewProductivitySection
        productivity={{
          pickers: [],
          totalKg: 0,
          totalLatas: 0,
          pickerCount: 0,
        }}
      />,
    );
    expect(
      screen.getByText(/hasn’t weighed any coffee today/i),
    ).toBeInTheDocument();
  });
});
