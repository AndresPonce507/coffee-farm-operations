import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DryingLot, DryingWeatherRisk, StationOccupancy } from "@/lib/types";

/**
 * /drying-station/[id] dossier page behavior test (mirrors the crew/lot exemplars).
 *
 * Async Server Component: resolves the station anchor with ONE getter → notFound()
 * BEFORE any section fetch (P2), then Promise.all's the lots + weather reads (P3) and
 * renders <DossierShell> + the three sections (P4). We mock the read ports (no
 * Supabase) and assert: a known id renders the title + cross-links each resting lot to
 * its /lots/[code] dossier (P6); an unknown id → 404 with no fabricated dossier.
 */

const station: StationOccupancy = {
  stationId: "st-patio-1",
  name: "Patio Norte",
  kind: "patio",
  capacityKg: 2000,
  committedKg: 800,
  availableKg: 1200,
};

const lots: DryingLot[] = [
  {
    lotCode: "JC-712",
    variety: "Geisha",
    currentKg: 320,
    stationId: "st-patio-1",
    stationName: "Patio Norte",
    reposo: {
      lotCode: "JC-712",
      latestMoisture: 12,
      readingCount: 3,
      moistureStable: false,
      dryingStartedAt: "2026-06-18",
      restDaysElapsed: 4,
      restMet: false,
      ready: false,
      reason: "resting",
    },
    curve: [],
  },
];

const risk: DryingWeatherRisk[] = [
  {
    stationId: "st-patio-1",
    name: "Patio Norte",
    kind: "patio",
    forecastOrder: 3,
    day: "Wed",
    rainPct: 80,
    icon: "rain",
    coverRisk: true,
  },
];

vi.mock("@/lib/db/dossier/drying-station", () => ({
  getDryingStationById: vi.fn(
    async (id: string): Promise<StationOccupancy | null> =>
      id === "st-patio-1" ? station : null,
  ),
  getDryingStationLots: vi.fn(async (): Promise<DryingLot[]> => lots),
  getDryingStationWeatherRisk: vi.fn(async (): Promise<DryingWeatherRisk[]> => risk),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import DryingStationDossierPage from "@/app/(app)/drying-station/[id]/page";
import { notFound } from "next/navigation";

afterEach(cleanup);

describe("/drying-station/[id] dossier", () => {
  it("renders the station dossier; each resting lot cross-links to its lot dossier; back → /drying", async () => {
    const ui = await DryingStationDossierPage({
      params: Promise.resolve({ id: "st-patio-1" }),
    });
    render(ui);

    expect(screen.getByText("Patio Norte")).toBeInTheDocument();

    const lotLink = screen.getByRole("link", { name: /Open lot JC-712/i });
    expect(lotLink).toHaveAttribute("href", "/lots/JC-712");

    const back = screen.getByRole("link", { name: /All drying stations/i });
    expect(back).toHaveAttribute("href", "/drying");
  });

  it("404s an unknown station id before fetching sections (no fabricated dossier)", async () => {
    await expect(
      DryingStationDossierPage({ params: Promise.resolve({ id: "nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
