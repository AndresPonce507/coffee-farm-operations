import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. Mixed roles / attendance
// exercise the role column, day-rate formatting, the today-kg "—" fallback for
// non-pickers, and every attendance badge tone.
vi.mock("@/lib/db/workers", () => ({
  getWorkers: vi.fn(
    async (): Promise<Worker[]> => [
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
    ],
  ),
}));

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
    const ui = await WorkerRosterTable();
    render(ui);

    // Stable card title + headcount description.
    expect(screen.getByText("Roster")).toBeInTheDocument();
    expect(screen.getByText("3 crew members across the farm")).toBeInTheDocument();

    // A worker row renders: name, role, and formatted day rate.
    expect(screen.getByText("Eduardo Pérez")).toBeInTheDocument();
    expect(screen.getByText("Picker")).toBeInTheDocument();
    expect(screen.getByText("$22")).toBeInTheDocument();
    // Picker's cherries-today cell.
    expect(screen.getByText("78 kg")).toBeInTheDocument();
  });
});
