import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// Async Server Component that reads the DB layer; mock the getter so the smoke
// test renders against a known shape with no network. One active picker, one idle.
vi.mock("@/lib/db/workers", () => ({
  getPickers: vi.fn(
    async (): Promise<Worker[]> => [
      {
        id: "w1", name: "Marisol Quintero", role: "Picker", dailyRateUsd: 22,
        attendance: "present", startedYear: 2019, phone: "+507 6000-0001",
        todayKg: 145, crew: "Crew Norte",
      },
      {
        id: "w2", name: "Diego Santamaría", role: "Picker", dailyRateUsd: 22,
        attendance: "present", startedYear: 2021, phone: "+507 6000-0002",
        todayKg: 98, crew: "Crew Sur",
      },
      {
        id: "w3", name: "Ana Beltrán", role: "Picker", dailyRateUsd: 22,
        attendance: "rest-day", startedYear: 2020, phone: "+507 6000-0003",
        todayKg: 0, crew: "Crew Norte",
      },
    ],
  ),
}));

import { TopPickersCard } from "@/components/sections/harvests/top-pickers-card";

describe("TopPickersCard (smoke)", () => {
  it("renders the picker leaderboard from the data layer without throwing", async () => {
    const ui = await TopPickersCard();
    render(ui);

    expect(screen.getByText("Top pickers today")).toBeInTheDocument();
    // Active picker name + their today total render in the leaderboard.
    expect(screen.getByText("Marisol Quintero")).toBeInTheDocument();
    expect(screen.getByText("145 kg")).toBeInTheDocument();
    // The rest-day picker shows under the "Off today" group.
    expect(screen.getByText("Off today")).toBeInTheDocument();
    expect(screen.getByText("Ana Beltrán")).toBeInTheDocument();
  });
});
