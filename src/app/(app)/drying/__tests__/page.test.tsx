import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DryingLot, DryingWeatherRisk, StationOccupancy } from "@/lib/types";

// The page is an async Server Component that awaits the three drying read ports.
// Mock them so the page composes against a known shape with no Supabase.
const lots: DryingLot[] = [
  {
    lotCode: "JC-571",
    variety: "Geisha",
    currentKg: 60,
    stationId: "st-bed-1",
    stationName: "African Bed 1",
    reposo: {
      lotCode: "JC-571",
      latestMoisture: 11.9,
      readingCount: 3,
      moistureStable: false,
      dryingStartedAt: "2026-06-14T08:00:00Z",
      restDaysElapsed: 6.2,
      restMet: true,
      ready: false,
      reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
    },
    curve: [{ lotCode: "JC-571", moisturePct: 11.9, occurredAt: "2026-06-19T08:00:00Z" }],
  },
];
const stations: StationOccupancy[] = [
  { stationId: "st-bed-1", name: "African Bed 1", kind: "raised-bed", capacityKg: 600, committedKg: 60, availableKg: 540 },
];
const weatherRisk: DryingWeatherRisk[] = [];

vi.mock("@/lib/db/drying", () => ({
  getDryingLots: vi.fn(async (): Promise<DryingLot[]> => lots),
  getStationOccupancy: vi.fn(async (): Promise<StationOccupancy[]> => stations),
  getDryingWeatherRisk: vi.fn(async (): Promise<DryingWeatherRisk[]> => weatherRisk),
}));

import DryingPage from "@/app/(app)/drying/page";

describe("/drying page (smoke)", () => {
  it("renders the header and both boards", async () => {
    const ui = await DryingPage();
    render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: /Drying & reposo/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Resting lots · the reposo gate")).toBeInTheDocument();
    expect(screen.getByText("Drying stations")).toBeInTheDocument();
  });

  it("surfaces the reposo gate verdict for a resting lot (blocked, with the reason)", async () => {
    const ui = await DryingPage();
    render(ui);

    expect(screen.getByText("JC-571")).toBeInTheDocument();
    // The blocked chip shows "Resting" and the mill button is locked.
    expect(screen.getByRole("status")).toHaveAttribute("data-ready", "false");
    expect(screen.getByRole("button", { name: /Mill — locked/i })).toBeDisabled();
  });
});
