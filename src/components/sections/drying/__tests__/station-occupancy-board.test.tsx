import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StationOccupancyBoard } from "@/components/sections/drying/station-occupancy-board";
import type { DryingWeatherRisk, StationOccupancy } from "@/lib/types";

const stations: StationOccupancy[] = [
  { stationId: "st-patio-1", name: "Patio Norte", kind: "patio", capacityKg: 2000, committedKg: 800, availableKg: 1200 },
  { stationId: "st-bed-1", name: "African Bed 1", kind: "raised-bed", capacityKg: 600, committedKg: 600, availableKg: 0 },
];

const risk: DryingWeatherRisk[] = [
  { stationId: "st-patio-1", name: "Patio Norte", kind: "patio", forecastOrder: 3, day: "Wed", rainPct: 80, icon: "rain", coverRisk: true },
];

describe("StationOccupancyBoard (smoke)", () => {
  it("renders a card per station with a capacity meter", () => {
    render(<StationOccupancyBoard stations={stations} weatherRisk={risk} />);
    expect(screen.getByText("Drying stations")).toBeInTheDocument();
    const cards = screen.getAllByTestId("station-card");
    expect(cards).toHaveLength(2);
    // Each card carries a dual-bar meter (role=meter from the ATP meter).
    expect(screen.getAllByRole("meter").length).toBeGreaterThanOrEqual(2);
  });

  it("flags a weather cover alert on an open-air station with high rain incoming", () => {
    render(<StationOccupancyBoard stations={stations} weatherRisk={risk} />);
    expect(screen.getByText(/Cover Wed/)).toBeInTheDocument();
  });

  it("shows a full station's utilization at 100%", () => {
    render(<StationOccupancyBoard stations={stations} weatherRisk={[]} />);
    const full = screen
      .getAllByTestId("station-card")
      .find((c) => within(c).queryByText("African Bed 1"));
    expect(full).toBeTruthy();
    expect(within(full!).getByText(/100% full/)).toBeInTheDocument();
  });

  it("renders an empty state with no stations", () => {
    render(<StationOccupancyBoard stations={[]} />);
    expect(screen.getByText(/No drying stations/i)).toBeInTheDocument();
  });
});
