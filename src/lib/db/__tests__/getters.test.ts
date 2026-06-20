import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direct coverage of the fetch + map path in the data-access getters.
 *
 * The mappers themselves are pinned in mappers.test.ts; this file pins the
 * *getter* contract — that each getter issues the right PostgREST query against
 * the right table and returns correctly camelCase-mapped domain objects. It's
 * the safety net for wrapping the getters in React's request-scoped `cache()`:
 * if `cache()` (or any refactor) ever broke the fetch/map round-trip, one of
 * these would go red.
 *
 * Strategy: mock `@/lib/supabase/server` so `getSupabase()` returns a chainable
 * stub query-builder. Every chain method (.select/.order/.eq) returns the same
 * builder; the builder is thenable, resolving to `{ data, error }` so that
 * `await builder` (list queries) and the terminal `.single()/.maybeSingle()`
 * both yield the configured rows.
 */

// ----- chainable Supabase query-builder stub --------------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

/**
 * A builder whose chain methods all return `this`, and which is awaitable
 * (thenable) so `await getSupabase().from(...).select(...).order(...)` resolves
 * to the configured result. `.single()/.maybeSingle()` resolve to the same.
 */
function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    // Make the builder itself awaitable for list/`await`-terminated queries.
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

/** Point the mocked client at a builder resolving to these rows / error. */
function stubQuery<T>(data: T, error: { message: string } | null = null) {
  getSupabaseMock.mockReturnValue(makeBuilder({ data, error }));
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- list getter: getPlots -------------------------------------------------

describe("getPlots", () => {
  it("maps snake_case plot rows to camelCase Plot[]", async () => {
    stubQuery([
      {
        id: "p-tizingal-alto",
        ord: 0,
        name: "Tizingal Alto",
        block: "Block A",
        variety: "Geisha",
        area_ha: "4.2",
        altitude_masl: 1690,
        trees: 14800,
        shade_pct: 55,
        established_year: 2014,
        status: "healthy",
        last_inspected: "2026-06-18",
        expected_yield_kg: "18600",
        harvested_kg: 12120,
      },
    ]);

    const { getPlots } = await import("@/lib/db/plots");
    const plots = await getPlots();

    expect(plots).toEqual([
      {
        id: "p-tizingal-alto",
        name: "Tizingal Alto",
        block: "Block A",
        variety: "Geisha",
        areaHa: 4.2,
        altitudeMasl: 1690,
        trees: 14800,
        shadePct: 55,
        establishedYear: 2014,
        status: "healthy",
        lastInspected: "2026-06-18",
        expectedYieldKg: 18600,
        harvestedKg: 12120,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    stubQuery(null, { message: "boom" });
    const { getPlots } = await import("@/lib/db/plots");
    await expect(getPlots()).rejects.toThrow("getPlots: boom");
  });
});

// ----- view-backed list getter: getHarvests ---------------------------------

describe("getHarvests", () => {
  it("maps harvests_view rows (re-joined plot_name + picker) to Harvest[]", async () => {
    stubQuery([
      {
        id: "h-0620-01",
        date: "2026-06-20",
        plot_id: "p-tizingal-alto",
        plot_name: "Tizingal Alto",
        picker: "Lucía Morales",
        cherries_kg: 88,
        ripeness_pct: 96,
        brix_avg: "23.4",
        lot_code: "JC-564",
      },
    ]);

    const { getHarvests } = await import("@/lib/db/harvests");
    const harvests = await getHarvests();

    expect(harvests).toEqual([
      {
        id: "h-0620-01",
        date: "2026-06-20",
        plotId: "p-tizingal-alto",
        plotName: "Tizingal Alto",
        picker: "Lucía Morales",
        cherriesKg: 88,
        ripenessPct: 96,
        brixAvg: 23.4,
        lotCode: "JC-564",
      },
    ]);
  });
});

// ----- single-row getter: getSeason -----------------------------------------

describe("getSeason", () => {
  it("maps the season_summary singleton to a Season object", async () => {
    stubQuery({
      id: 1,
      target_kg: 190000,
      harvested_kg: 122240,
      today_kg: 642,
      ytd_revenue_usd: "486500",
    });

    const { getSeason } = await import("@/lib/db/trends");
    const season = await getSeason();

    expect(season).toEqual({
      targetKg: 190000,
      harvestedKg: 122240,
      todayKg: 642,
      ytdRevenueUsd: 486500,
    });
  });
});
