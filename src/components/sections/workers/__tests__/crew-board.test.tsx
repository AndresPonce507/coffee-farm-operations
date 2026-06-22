import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Crew } from "@/lib/db/people";

// CrewBoard is an async Server Component that now reads crews LIVE via getCrews()
// (the mock-free replacement for the hardcoded CREWS const). Mock the getter so
// the smoke test renders against a known shape with no network. The legacy
// `getWorkers` read is gone — only getCrews is mocked here.
const CREWS: Crew[] = [
  { crewId: "crew-norte", crewName: "Crew Norte", memberCount: 3, presentCount: 2 },
  { crewId: "crew-mill", crewName: "Crew Mill", memberCount: 2, presentCount: 2 },
  // A crew with no crewId (legacy / unassigned grouping) must still render its
  // card, but WITHOUT a dossier link (getCrewById can't resolve a null id → 404).
  { crewId: null, crewName: "Sin cuadrilla", memberCount: 1, presentCount: 0 },
];

vi.mock("@/lib/db/people", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/people")>()),
  getCrews: vi.fn(async (): Promise<Crew[]> => CREWS),
}));

// CrewBoard still reads getWorkers() for the per-crew avatar wrap; mock it so the
// smoke test renders with no network. One worker per linkable crew lands an avatar.
vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(async () => [
    {
      id: "w1", name: "Eduardo Pérez", role: "Picker", dailyRateUsd: 22,
      attendance: "present", startedYear: 2015, phone: "+507 6612-7741",
      todayKg: 78, crew: "Crew Norte",
    },
    {
      id: "w2", name: "Néstor Gómez", role: "Mill Operator", dailyRateUsd: 30,
      attendance: "present", startedYear: 2013, phone: "+507 6701-5589",
      todayKg: 0, crew: "Crew Mill",
    },
  ]),
}));

import { CrewBoard } from "@/components/sections/workers/crew-board";

describe("CrewBoard (smoke)", () => {
  it("renders one panel per LIVE crew from getCrews without throwing", async () => {
    const ui = await CrewBoard();
    render(ui);

    expect(screen.getByText("Crews")).toBeInTheDocument();
    expect(
      screen.getByText("Field teams and today’s presence on the farm"),
    ).toBeInTheDocument();

    // Each live crew renders its name + the crew-count badge reflects them.
    expect(screen.getByText("Crew Norte")).toBeInTheDocument();
    expect(screen.getByText("Crew Mill")).toBeInTheDocument();
    expect(screen.getByText("Sin cuadrilla")).toBeInTheDocument();
    expect(screen.getByText("3 crews")).toBeInTheDocument();
  });

  it("wires each crew with a crewId to its /crew/[id] dossier", async () => {
    const ui = await CrewBoard();
    const { container } = render(ui);

    const norteLink = screen
      .getByText("Crew Norte")
      .closest("a") as HTMLAnchorElement | null;
    expect(norteLink).not.toBeNull();
    expect(norteLink).toHaveAttribute("href", "/crew/crew-norte");

    const millLink = screen
      .getByText("Crew Mill")
      .closest("a") as HTMLAnchorElement | null;
    expect(millLink).toHaveAttribute("href", "/crew/crew-mill");

    // The crewId-less crew renders, but is NOT wrapped in a dossier link.
    expect(screen.getByText("Sin cuadrilla").closest("a")).toBeNull();

    // Exactly two crew cards are linkable (the two with a crewId).
    const hrefs = Array.from(container.querySelectorAll('a[href^="/crew/"]'));
    expect(hrefs).toHaveLength(2);
  });
});
