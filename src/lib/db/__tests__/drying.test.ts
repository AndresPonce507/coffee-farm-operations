import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MoistureReadingRow,
  ReposoStatusRow,
  StationOccupancyRow,
  DryingWeatherRiskRow,
} from "@/lib/db/drying";

/**
 * Coverage of the `drying.ts` READ-port (P2-S4 — drying management + the reposo
 * gate): the pure mappers (snake_case row → camelCase domain, numeric coercion of
 * the moisture / capacity / rest-days columns PostgREST may serialize as strings,
 * and the null handling for a lot with no readings yet) and the `cache()`-wrapped
 * getters' fetch + map round-trip.
 *
 * Strategy mirrors `greenlots.test.ts`: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable per-table query-builder. The reposo
 * verdict + the ATP arithmetic are the DB's job (pinned by the migration's PGlite
 * tests, not re-implemented here); this port only proves the row→domain seam.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}
type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  return {
    from: (table: string) => {
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        // maybeSingle() resolves to the stubbed result directly (its `data` is the
        // single row, mirroring PostgREST's single-object response shape).
        maybeSingle: vi.fn(() => Promise.resolve(result)),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getSupabase: () => getSupabaseMock() }));
function stubTables(results: TableResults) {
  getSupabaseMock.mockReturnValue(makeClient(results));
}

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

// ----- sample rows ----------------------------------------------------------

const stationRow: StationOccupancyRow = {
  station_id: "st-bed-1",
  name: "African Bed 1",
  kind: "raised-bed",
  capacity_kg: "600",
  committed_kg: "120",
  available_kg: "480",
};

const reposoBlockedRow: ReposoStatusRow = {
  lot_code: "JC-571",
  latest_moisture: "11.9",
  reading_count: 3,
  moisture_stable: false,
  drying_started_at: "2026-06-14T08:00:00Z",
  rest_days_elapsed: "6.1",
  rest_met: true,
  ready: false,
  reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
};

const reposoFreshRow: ReposoStatusRow = {
  lot_code: "JC-572",
  latest_moisture: null, // no readings yet
  reading_count: 0,
  moisture_stable: false,
  drying_started_at: null,
  rest_days_elapsed: null,
  rest_met: false,
  ready: false,
  reason: "no drying record yet",
};

const moistureRow: MoistureReadingRow = {
  lot_code: "JC-571",
  moisture_pct: "11.2",
  occurred_at: "2026-06-19T15:00:00Z",
};

const weatherRiskRow: DryingWeatherRiskRow = {
  station_id: "st-patio-1",
  name: "Patio Norte",
  kind: "patio",
  forecast_order: 3,
  day: "Wed",
  rain_pct: 80,
  icon: "rain",
  cover_risk: true,
};

// ----- pure mappers ---------------------------------------------------------

describe("mapStationOccupancy", () => {
  it("coerces every capacity/committed/available string to a number", async () => {
    const { mapStationOccupancy } = await import("@/lib/db/drying");
    expect(mapStationOccupancy(stationRow)).toEqual({
      stationId: "st-bed-1",
      name: "African Bed 1",
      kind: "raised-bed",
      capacityKg: 600,
      committedKg: 120,
      availableKg: 480,
    });
  });
});

describe("mapReposoStatus", () => {
  it("maps a blocked reposo row with numeric coercion of moisture + rest-days", async () => {
    const { mapReposoStatus } = await import("@/lib/db/drying");
    expect(mapReposoStatus(reposoBlockedRow)).toEqual({
      lotCode: "JC-571",
      latestMoisture: 11.9,
      readingCount: 3,
      moistureStable: false,
      dryingStartedAt: "2026-06-14T08:00:00Z",
      restDaysElapsed: 6.1,
      restMet: true,
      ready: false,
      reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
    });
  });

  it("keeps latestMoisture / restDaysElapsed NULL for a lot with no readings (never a fabricated 0)", async () => {
    const { mapReposoStatus } = await import("@/lib/db/drying");
    const r = mapReposoStatus(reposoFreshRow);
    expect(r.latestMoisture).toBeNull();
    expect(r.restDaysElapsed).toBeNull();
    expect(r.ready).toBe(false);
  });
});

describe("mapMoistureReading", () => {
  it("coerces the moisture_pct string to a number", async () => {
    const { mapMoistureReading } = await import("@/lib/db/drying");
    expect(mapMoistureReading(moistureRow)).toEqual({
      lotCode: "JC-571",
      moisturePct: 11.2,
      occurredAt: "2026-06-19T15:00:00Z",
    });
  });
});

describe("mapDryingWeatherRisk", () => {
  it("maps an open-air cover-risk row with the boolean flag intact", async () => {
    const { mapDryingWeatherRisk } = await import("@/lib/db/drying");
    expect(mapDryingWeatherRisk(weatherRiskRow)).toEqual({
      stationId: "st-patio-1",
      name: "Patio Norte",
      kind: "patio",
      forecastOrder: 3,
      day: "Wed",
      rainPct: 80,
      icon: "rain",
      coverRisk: true,
    });
  });
});

// ----- getters --------------------------------------------------------------

describe("getStationOccupancy", () => {
  it("reads the station_occupancy view and returns camelCase rows", async () => {
    stubTables({ station_occupancy: { data: [stationRow], error: null } });
    const { getStationOccupancy } = await import("@/lib/db/drying");
    const rows = await getStationOccupancy();
    expect(rows).toHaveLength(1);
    expect(rows[0].stationId).toBe("st-bed-1");
    expect(rows[0].availableKg).toBe(480);
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ station_occupancy: { data: null, error: { message: "boom" } } });
    const { getStationOccupancy } = await import("@/lib/db/drying");
    await expect(getStationOccupancy()).rejects.toThrow("getStationOccupancy: boom");
  });
});

describe("getReposoStatuses", () => {
  it("reads v_reposo_status and returns camelCase rows", async () => {
    stubTables({ v_reposo_status: { data: [reposoBlockedRow], error: null } });
    const { getReposoStatuses } = await import("@/lib/db/drying");
    const rows = await getReposoStatuses();
    expect(rows[0].lotCode).toBe("JC-571");
    expect(rows[0].ready).toBe(false);
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ v_reposo_status: { data: null, error: { message: "rs boom" } } });
    const { getReposoStatuses } = await import("@/lib/db/drying");
    await expect(getReposoStatuses()).rejects.toThrow("getReposoStatuses: rs boom");
  });
});

describe("getDryingWeatherRisk", () => {
  it("reads v_drying_weather_risk and returns camelCase rows", async () => {
    stubTables({ v_drying_weather_risk: { data: [weatherRiskRow], error: null } });
    const { getDryingWeatherRisk } = await import("@/lib/db/drying");
    const rows = await getDryingWeatherRisk();
    expect(rows[0].coverRisk).toBe(true);
  });
});

describe("getReposoBand", () => {
  it("reads the tuned reposo band from farm_season_config and coerces numeric strings", async () => {
    stubTables({
      farm_season_config: {
        data: { reposo_moisture_min_pct: "9.8", reposo_moisture_max_pct: "12.2" },
        error: null,
      },
    });
    const { getReposoBand } = await import("@/lib/db/drying");
    const band = await getReposoBand();
    expect(band).toEqual({ min: 9.8, max: 12.2 });
  });

  it("falls back to the migration's 10.5–11.5% defaults when no config row exists", async () => {
    stubTables({ farm_season_config: { data: null, error: null } });
    const { getReposoBand } = await import("@/lib/db/drying");
    expect(await getReposoBand()).toEqual({ min: 10.5, max: 11.5 });
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ farm_season_config: { data: null, error: { message: "cfg boom" } } });
    const { getReposoBand } = await import("@/lib/db/drying");
    await expect(getReposoBand()).rejects.toThrow("getReposoBand: cfg boom");
  });
});

describe("getDryingLots (composition)", () => {
  it("joins reposo status + station + moisture curve into a DryingLot per resting lot", async () => {
    stubTables({
      v_reposo_status: { data: [reposoBlockedRow], error: null },
      station_occupancy: { data: [stationRow], error: null },
      moisture_readings: { data: [moistureRow], error: null },
      drying_assignments: {
        data: [{ lot_code: "JC-571", station_id: "st-bed-1", released_at: null }],
        error: null,
      },
      lots: {
        data: [{ code: "JC-571", variety: "Geisha", current_kg: "120" }],
        error: null,
      },
    });
    const { getDryingLots } = await import("@/lib/db/drying");
    const lots = await getDryingLots();
    expect(lots).toHaveLength(1);
    const lot = lots[0];
    expect(lot.lotCode).toBe("JC-571");
    expect(lot.variety).toBe("Geisha");
    expect(lot.currentKg).toBe(120);
    expect(lot.stationId).toBe("st-bed-1");
    expect(lot.stationName).toBe("African Bed 1");
    expect(lot.reposo.ready).toBe(false);
    expect(lot.curve).toHaveLength(1);
    expect(lot.curve[0].moisturePct).toBe(11.2);
  });
});
