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

  /**
   * DEPTH TICKET — wire-up-audit §10: station cards are cosmetic.
   * The /drying-station/[id] dossier route does not exist yet; no EntityLink
   * is possible until that route is created (and entity-href.ts + entity-link.tsx
   * are extended). This test documents the gap so the dossier slice can pick it up:
   * it asserts the station name renders as plain text (not an <a>), and will need
   * to be updated to `toHaveAttribute("href", "/drying-station/st-patio-1")` once
   * the dossier route ships.
   */
  it("station name is plain text (not a link) — depth ticket until drying-station dossier exists", () => {
    render(<StationOccupancyBoard stations={stations} weatherRisk={[]} />);
    const cards = screen.getAllByTestId("station-card");
    const patioCard = cards.find((c) => within(c).queryByText("Patio Norte"));
    expect(patioCard).toBeTruthy();
    // The station name should be rendered as text inside the card.
    const nameEl = within(patioCard!).getByText("Patio Norte");
    expect(nameEl).toBeInTheDocument();
    // NOT a link yet — /drying-station/[id] route does not exist.
    // TODO(drying-station-dossier): wrap in <EntityLink kind="drying-station" id={s.stationId}>
    // once the route is created and entity-href.ts / DossierKind are extended.
    expect(nameEl.closest("a")).toBeNull();
  });
});
