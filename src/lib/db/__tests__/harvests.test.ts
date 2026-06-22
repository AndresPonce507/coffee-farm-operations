import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 L2 dossier getter — `getHarvestsForPlot(plotId)` (facet-02 §7).
 *
 * The /plots/[id] dossier's Harvests section reads every harvest for one plot.
 * This is a thin, additive, read-only getter over the SAME `harvests_view`
 * `getHarvests()` reads, narrowed with `.eq("plot_id", id)` and ordered newest
 * first (so the section reads as a reverse-chronological log). The `mapHarvest`
 * row→domain seam is pinned in getters.test.ts; this file pins the new getter's
 * fetch/filter/order contract against a mocked PostgREST builder.
 *
 * Strategy mirrors getters.test.ts: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder recording
 * from/eq/order calls.
 */

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeClient<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
  };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    order: vi.fn((col: string, opts?: Record<string, unknown>) => {
      calls.orderArgs.push([col, opts]);
      return builder;
    }),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      calls.from = table;
      return builder;
    },
  };
  return { client, calls };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

describe("getHarvestsForPlot", () => {
  const row = {
    id: "h-0620-01",
    date: "2026-06-20",
    plot_id: "p-tizingal-alto",
    plot_name: "Tizingal Alto",
    picker: "Lucía Morales",
    cherries_kg: 88,
    ripeness_pct: 96,
    brix_avg: "23.4",
    lot_code: "JC-564",
  };

  it("reads harvests_view filtered by plot_id, newest first, and maps rows", async () => {
    const { client, calls } = makeClient({ data: [row], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getHarvestsForPlot } = await import("@/lib/db/harvests");
    const harvests = await getHarvestsForPlot("p-tizingal-alto");

    expect(calls.from).toBe("harvests_view");
    expect(calls.eqArgs).toContainEqual(["plot_id", "p-tizingal-alto"]);
    expect(calls.orderArgs[0][0]).toBe("date");
    expect(calls.orderArgs[0][1]).toEqual({ ascending: false });

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

  it("returns an empty array for a plot with no harvests (honest empty, not a throw)", async () => {
    const { client } = makeClient({ data: [], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getHarvestsForPlot } = await import("@/lib/db/harvests");
    expect(await getHarvestsForPlot("p-unknown")).toEqual([]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);

    const { getHarvestsForPlot } = await import("@/lib/db/harvests");
    await expect(getHarvestsForPlot("p-1")).rejects.toThrow(
      "getHarvestsForPlot: boom",
    );
  });
});
