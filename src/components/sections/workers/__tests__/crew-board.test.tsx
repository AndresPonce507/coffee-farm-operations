import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. NOTE: CrewBoard also reads
// the real `CREWS` const from "@/lib/data/workers" — that is NOT mocked, so it
// always renders all four crew columns. Each mock worker's `crew` is one of the
// real CREWS values ("Crew Norte" / "Field Ops" / "Crew Mill") so they land in a
// column; "Crew Tizingal" is intentionally left empty to exercise the
// "No one assigned" branch.
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

import { CrewBoard } from "@/components/sections/workers/crew-board";

describe("CrewBoard (smoke)", () => {
  it("renders one panel per real CREW from the data layer without throwing", async () => {
    const ui = await CrewBoard();
    render(ui);

    // Stable card title + description.
    expect(screen.getByText("Crews")).toBeInTheDocument();
    expect(
      screen.getByText("Field teams and today’s presence on the farm"),
    ).toBeInTheDocument();

    // The four real CREWS each render a column heading.
    expect(screen.getByText("Crew Norte")).toBeInTheDocument();
    expect(screen.getByText("Crew Tizingal")).toBeInTheDocument();
    expect(screen.getByText("Crew Mill")).toBeInTheDocument();
    expect(screen.getByText("Field Ops")).toBeInTheDocument();

    // Crew count badge reflects the 4 real CREWS.
    expect(screen.getByText("4 crews")).toBeInTheDocument();
    // The empty crew (Crew Tizingal) shows the empty-state copy.
    expect(screen.getByText("No one assigned")).toBeInTheDocument();
  });
});
