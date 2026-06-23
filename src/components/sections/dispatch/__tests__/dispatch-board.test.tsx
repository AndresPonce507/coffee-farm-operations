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

// Capture the props the board hands the generate island so we can assert the board
// no longer relies on the island's silent default readiness threshold (the D08-1
// cold-model gap: a hardwired 0.5 cut-off yields an empty card on a cold S8 model).
const generateButtonProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/sections/dispatch/generate-dispatch-button", () => ({
  GenerateDispatchButton: (props: Record<string, unknown>) => {
    generateButtonProps.push(props);
    return (
      <button type="button" data-testid="generate-stub">
        {String(props.alreadyDrafted) === "true" ? "Re-draft" : "Generate dispatch"}
      </button>
    );
  },
}));

import { DispatchBoard } from "@/components/sections/dispatch/dispatch-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  generateButtonProps.length = 0;
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

const tizingalAckCard: DispatchCard = {
  id: 2,
  crewId: "crew-tizingal",
  crewName: "Crew Tizingal",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "acknowledged",
  sentChannel: "web-share",
  readinessThreshold: 0.5,
  idempotencyKey: "disp-2",
  plotCount: 1,
  plots: [
    {
      id: 20,
      dispatchRunId: 2,
      plotId: "p-tiz-1",
      plotName: "Tizingal Alto",
      variety: "Geisha",
      altitudeMasl: 1700,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "high",
      readiness: 0.9,
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

  // D08-2 (board portion): the 'acknowledged' run state is a first-class DB state
  // that getDispatchToday already maps, yet the board previously hid it inside the
  // "Shared" tally. Surface it as its own headline tile so the manager can see a
  // crew lead confirmed (the acknowledged badge is otherwise perpetually invisible).
  it("surfaces acknowledged runs in their own headline tile", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([tizingalAckCard]);

    render(await DispatchBoard());

    const summary = screen.getByTestId("dispatch-summary");
    // a dedicated Acknowledged tile exists and counts the acknowledged run.
    const ackTile = summary.querySelector('[data-testid="dispatch-tile-acknowledged"]');
    expect(ackTile).not.toBeNull();
    expect(ackTile?.textContent).toMatch(/Acknowledged/i);
    // the acknowledged run is tallied in ITS OWN tile (the bold value paragraph = 1),
    // no longer invisible / folded only into "Shared".
    const ackValue = ackTile?.querySelector("p.font-display");
    expect(ackValue?.textContent).toBe("1");
  });

  // Crew column header must be an EntityLink navigating to /crew/[id].
  it("crew column header links to the crew dossier", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([norteCard]);

    render(await DispatchBoard());

    // EntityLink renders an <a> with aria-label "Abrir cuadrilla <crewName>" (human name, not slug).
    // WCAG 2.5.3: the accessible name must contain the visible label.
    const link = screen.getByRole("link", { name: /abrir cuadrilla Crew Norte/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/crew/crew-norte");
  });

  // Dispatch card must link to /dispatch/[id] so tapping the card opens the dossier.
  it("dispatch card preview links to the dispatch dossier", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([norteCard]);

    render(await DispatchBoard());

    // norteCard.id === 1 → href must be /dispatch/1
    const links = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/dispatch/1");
    expect(links.length).toBeGreaterThan(0);
  });

  // D08-1 (board portion / interim mitigation): the board must NOT lean on the
  // generate island's silent default readiness threshold (0.5) — on a cold S8 model
  // every plot scores readiness 0, so a 0.5 cut-off drafts an EMPTY card with no way
  // to recover. The board now passes an explicit, cold-start-aware threshold below
  // 0.5 so marginally-ready plots are surfaced for the manager to review.
  it("passes an explicit cold-start readiness threshold (< 0.5) to the generate island", async () => {
    getCrewRoster.mockResolvedValue(roster);
    getDispatchToday.mockResolvedValue([]); // no dispatches yet

    render(await DispatchBoard());

    expect(generateButtonProps.length).toBeGreaterThan(0);
    for (const props of generateButtonProps) {
      expect(typeof props.readinessThreshold).toBe("number");
      const thr = props.readinessThreshold as number;
      expect(thr).toBeGreaterThan(0);
      expect(thr).toBeLessThan(0.5);
    }
  });
});
