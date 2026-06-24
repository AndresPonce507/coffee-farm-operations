import { describe, expect, it, vi } from "vitest";

import type { DryingLot, DryingWeatherRisk, ReposoStatus } from "@/lib/types";

/**
 * drying-station read-port unit tests — prove the app-side filters in
 * getDryingStationLots / getDryingStationWeatherRisk actually scope to the station id
 * (a `!==` typo or a dropped filter would be caught here, not only by the page test
 * which mocks these loaders out). The underlying `getDryingLots` / `getDryingWeatherRisk`
 * are tenant-RLS-scoped already, so these only narrow an already-safe set.
 */

const reposo = (lotCode: string): ReposoStatus => ({
  lotCode,
  latestMoisture: 12,
  readingCount: 2,
  moistureStable: false,
  dryingStartedAt: "2026-06-18",
  restDaysElapsed: 3,
  restMet: false,
  ready: false,
  reason: "resting",
});
const lot = (lotCode: string, stationId: string | null): DryingLot => ({
  lotCode,
  variety: "Geisha",
  currentKg: 200,
  stationId,
  stationName: stationId,
  reposo: reposo(lotCode),
  curve: [],
});
const risk = (stationId: string, forecastOrder: number): DryingWeatherRisk => ({
  stationId,
  name: stationId,
  kind: "patio",
  forecastOrder,
  day: "Mon",
  rainPct: 70,
  icon: "rain",
  coverRisk: true,
});

const allLots = [lot("JC-1", "st-1"), lot("JC-2", "st-2"), lot("JC-3", null)];
const allRisk = [risk("st-1", 3), risk("st-1", 1), risk("st-2", 1)];

vi.mock("@/lib/db/drying", () => ({
  getDryingLots: vi.fn(async () => allLots),
  getDryingWeatherRisk: vi.fn(async () => allRisk),
  mapStationOccupancy: vi.fn(),
}));

import {
  getDryingStationLots,
  getDryingStationWeatherRisk,
} from "@/lib/db/dossier/drying-station";

describe("drying-station dossier read-ports", () => {
  it("getDryingStationLots returns only this station's lots (drops other stations + unassigned)", async () => {
    const lots = await getDryingStationLots("st-1");
    expect(lots.map((l) => l.lotCode)).toEqual(["JC-1"]);
  });

  it("getDryingStationWeatherRisk filters to the station AND sorts by forecastOrder", async () => {
    const r = await getDryingStationWeatherRisk("st-1");
    expect(r.map((x) => x.forecastOrder)).toEqual([1, 3]); // st-1 only, ascending
  });
});
