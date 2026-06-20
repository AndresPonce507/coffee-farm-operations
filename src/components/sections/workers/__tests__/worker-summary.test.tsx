import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. Three workers across mixed
// roles / crews / attendance make the derived counts deterministic:
//   headcount = 3, present = 2, daily payroll (present only) = 22 + 48 = $70, crews = 3.
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

import { WorkerSummary } from "@/components/sections/workers/worker-summary";

describe("WorkerSummary (smoke)", () => {
  it("renders the workforce KPI tiles from the data layer without throwing", async () => {
    const ui = await WorkerSummary();
    render(ui);

    // Stable tile labels.
    expect(screen.getByText("Headcount")).toBeInTheDocument();
    expect(screen.getByText("Present today")).toBeInTheDocument();
    expect(screen.getByText("Daily payroll")).toBeInTheDocument();
    expect(screen.getByText("Crews")).toBeInTheDocument();

    // Daily payroll across the 2 present workers = $22 + $48 = $70.
    expect(screen.getByText("$70")).toBeInTheDocument();
    // "1 off" sub on the Present tile (3 headcount - 2 present).
    expect(screen.getByText("1 off")).toBeInTheDocument();
  });
});
