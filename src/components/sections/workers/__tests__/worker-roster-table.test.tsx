import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. Configurable per-test so
// both the populated roster and the empty roster can be exercised.
const getWorkersMock = vi.fn();
vi.mock("@/lib/db/workers", () => ({
  getWorkers: () => getWorkersMock(),
}));

// The table now also reads crews LIVE (for the inline edit form's crew picker);
// mock getCrews so the smoke test renders with no network.
vi.mock("@/lib/db/people", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/people")>()),
  getCrews: vi.fn(async () => [
    { crewId: "crew-norte", crewName: "Crew Norte", memberCount: 2, presentCount: 2 },
    { crewId: "field-ops", crewName: "Field Ops", memberCount: 1, presentCount: 1 },
  ]),
}));

// Mixed roles / attendance exercise the role column, day-rate formatting, the
// today-kg "—" fallback for non-pickers, and every attendance badge tone.
const ROSTER: Worker[] = [
  {
    id: "w1", name: "Eduardo Pérez", role: "Picker", dailyRateUsd: 22,
    attendance: "present", startedYear: 2015, phone: "+507 6612-7741",
    todayKg: 78, crew: "Crew Norte",
  },
  {
    id: "w2", name: "Janette Janson", role: "Agronomist", dailyRateUsd: 48,
    attendance: "present", startedYear: 2011, phone: "+507 6500-3382",
    todayKg: 0, crew: "Field Ops",
  },
  {
    id: "w3", name: "Néstor Gómez", role: "Mill Operator", dailyRateUsd: 30,
    attendance: "absent", startedYear: 2013, phone: "+507 6701-5589",
    todayKg: 0, crew: "Crew Mill",
  },
];

// WorkerRowActions imports the Server Actions; stub them so the table renders
// without pulling in next/cache or the Supabase client.
vi.mock("@/lib/actions/workers", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
  deleteWorker: vi.fn(),
  IDLE: { status: "idle" },
}));

import { WorkerRosterTable } from "@/components/sections/workers/worker-roster-table";

describe("WorkerRosterTable (smoke)", () => {
  it("renders the roster rows from the data layer without throwing", async () => {
    getWorkersMock.mockResolvedValue(ROSTER);
    const ui = await WorkerRosterTable();
    render(ui);

    // Stable card title + headcount description.
    expect(screen.getByText("Payroll")).toBeInTheDocument();
    expect(screen.getByText("3 crew members on the farm")).toBeInTheDocument();

    // A worker row renders: name, role, and formatted day rate.
    expect(screen.getByText("Eduardo Pérez")).toBeInTheDocument();
    expect(screen.getByText("Picker")).toBeInTheDocument();
    expect(screen.getByText("$22")).toBeInTheDocument();
    // Picker's cherries-today cell.
    expect(screen.getByText("78 kg")).toBeInTheDocument();
  });

  it("wires each worker name to its /workers/[id] dossier", async () => {
    getWorkersMock.mockResolvedValue(ROSTER);
    const ui = await WorkerRosterTable();
    render(ui);

    const link = screen
      .getByText("Eduardo Pérez")
      .closest("a") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/workers/w1");

    const link2 = screen
      .getByText("Janette Janson")
      .closest("a") as HTMLAnchorElement | null;
    expect(link2).toHaveAttribute("href", "/workers/w2");
  });

  it("wires each crew cell to its /crew/[id] dossier via name→id lookup", async () => {
    getWorkersMock.mockResolvedValue(ROSTER);
    const ui = await WorkerRosterTable();
    render(ui);

    // "Crew Norte" → crewId "crew-norte" (from the mocked getCrews above)
    const crewNorteLink = screen
      .getByText("Crew Norte")
      .closest("a") as HTMLAnchorElement | null;
    expect(crewNorteLink).not.toBeNull();
    expect(crewNorteLink).toHaveAttribute("href", "/crew/crew-norte");

    // "Field Ops" → crewId "field-ops"
    const fieldOpsLink = screen
      .getByText("Field Ops")
      .closest("a") as HTMLAnchorElement | null;
    expect(fieldOpsLink).not.toBeNull();
    expect(fieldOpsLink).toHaveAttribute("href", "/crew/field-ops");

    // "Crew Mill" has no matching crew in the mock data → rendered as plain text
    const crewMillEl = screen.getByText("Crew Mill");
    expect(crewMillEl.closest("a")).toBeNull();
  });

  it("renders a single empty-state row when the roster is empty", async () => {
    getWorkersMock.mockResolvedValue([]);
    const ui = await WorkerRosterTable();
    render(ui);

    // The card still frames the section, but no worker rows render …
    expect(screen.getByText("Payroll")).toBeInTheDocument();
    expect(screen.queryByText("Eduardo Pérez")).not.toBeInTheDocument();
    // … a tasteful empty-state stands in instead.
    expect(screen.getByText(/no workers yet/i)).toBeInTheDocument();
  });
});
