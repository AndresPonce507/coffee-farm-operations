import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. The three rows span all
// three attendance states (2 present, 0 rest-day, 1 absent) so the donut + legend
// tallies are deterministic.
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

import { AttendanceCard } from "@/components/sections/workers/attendance-card";

describe("AttendanceCard (smoke)", () => {
  it("renders the attendance donut + legend from the data layer without throwing", async () => {
    const ui = await AttendanceCard();
    render(ui);

    // Stable card title + legend labels.
    expect(screen.getByText("Attendance")).toBeInTheDocument();
    expect(screen.getByText("Present")).toBeInTheDocument();
    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();

    // 2 of 3 present → "67%" share on the Present legend row.
    expect(screen.getByText("67%")).toBeInTheDocument();
    // Present count "2" appears in the donut center and the Present legend row.
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });
});
