import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * /crew page smoke test. The page is an async Server Component that fetches from the
 * `people` read ports and composes three presentational sections. We stub the ports
 * (so no DB is needed) and the section components (so this asserts the PAGE's job:
 * the header + summary + roster board, wired in order with the data it fetched).
 */

vi.mock("@/lib/db/people", () => ({
  getCrewRoster: vi.fn(async () => [
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
      workerId: "w-03",
      name: "Eduardo Pérez",
      role: "Picker",
      crewName: "Crew Norte",
      crewId: "crew-norte",
      attendance: "rest-day",
      preferredName: null,
      comarcaOrigin: null,
      languages: ["es"],
      rehireEligible: true,
    },
  ]),
  getWorkerCertsValid: vi.fn(async (id: string) =>
    id === "w-06"
      ? [
          {
            workerId: "w-06",
            certKind: "pesticide-handling",
            issuedAt: "2026-01-15",
            expiresAt: "2027-01-15",
            issuer: "MIDA Panamá",
          },
        ]
      : [],
  ),
  getWorkerAttendanceTimeline: vi.fn(async () => []),
  getWorkerPorObraHistory: vi.fn(async () => []),
  verifyAttendanceChain: vi.fn(async () => true),
}));

// The rehire strip is a client island composing the server action; stub it so the
// page test stays a pure server-component composition check (no action wiring here).
vi.mock("@/app/(app)/crew/actions", () => ({
  rehireWorkerAction: vi.fn(async () => ({ status: "idle" })),
}));

vi.mock("@/components/sections/crew/crew-rehire-strip", () => ({
  CrewRehireStrip: ({ members }: { members: Array<{ workerId: string }> }) => (
    <div data-testid="crew-rehire-stub">eligible:{members.length}</div>
  ),
}));

vi.mock("@/components/sections/crew/crew-summary", () => ({
  CrewSummary: ({
    crews,
    members,
    presentToday,
  }: {
    crews: number;
    members: number;
    presentToday: number;
  }) => (
    <div data-testid="crew-summary-stub">
      {crews}-{members}-{presentToday}
    </div>
  ),
}));

vi.mock("@/components/sections/crew/crew-roster-board", () => ({
  CrewRosterBoard: ({
    members,
    certsByWorker,
  }: {
    members: Array<{ workerId: string }>;
    certsByWorker?: Record<string, unknown[]>;
  }) => (
    <div data-testid="crew-roster-stub">
      members:{members.length} certs:{Object.keys(certsByWorker ?? {}).length}
    </div>
  ),
}));

import CrewPage from "@/app/(app)/crew/page";

afterEach(cleanup);

describe("/crew page (smoke)", () => {
  it("renders the header above the summary and roster, fed the fetched data", async () => {
    // Async Server Component → await it to a resolved element, then render.
    const ui = await CrewPage();
    render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: "Crew" }),
    ).toBeInTheDocument();

    // summary derives: 2 distinct crews, 2 members, 1 present today.
    expect(screen.getByTestId("crew-summary-stub")).toHaveTextContent("2-2-1");

    // roster gets all 2 members and exactly 1 worker's certs (w-06 only).
    expect(screen.getByTestId("crew-roster-stub")).toHaveTextContent(
      "members:2 certs:1",
    );

    // both seeded members are rehire-eligible, so the rehire strip gets both.
    expect(screen.getByTestId("crew-rehire-stub")).toHaveTextContent(
      "eligible:2",
    );
  });
});
