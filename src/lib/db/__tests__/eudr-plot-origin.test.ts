import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OriginPlotRow } from "@/lib/db/eudr";

/**
 * Phase 5 L2 dossier getter — `getPlotOriginStatus(plotId)` (facet-02 §7).
 *
 * The /plots/[id] dossier's EUDR-origin section needs the plot's OWN due-diligence
 * facts (geolocated + deforestation-free + declaration basis) and the green lots
 * it feeds. `lot_origin_plots` carries those plot-level facts keyed by
 * green_lot_code+plot_id, so filtering by `plot_id` yields one row per green lot
 * the plot feeds — each carrying the SAME plot-level facts. This thin, additive,
 * read-only getter composes them into a single plot-centric status (the plot's
 * facts + the list of lots it feeds), or null when the plot feeds no green lot
 * (no fabricated compliance). The `mapOriginPlot` seam is pinned in eudr.test.ts.
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

const rowFor = (green_lot_code: string): OriginPlotRow => ({
  green_lot_code,
  plot_id: "p-baru-vista",
  plot_name: "Barú Vista",
  established_year: 2014,
  centroid: { type: "Point", coordinates: [-82.55, 8.81] },
  geolocated: true,
  deforestation_free: true,
  decl_basis: "2014 satellite baseline + owner declaration",
});

describe("getPlotOriginStatus", () => {
  it("reads lot_origin_plots filtered by plot_id and composes the plot's EUDR facts + the lots it feeds", async () => {
    const { client, calls } = makeClient({
      data: [rowFor("JC-701"), rowFor("JC-711")],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotOriginStatus } = await import("@/lib/db/eudr");
    const status = await getPlotOriginStatus("p-baru-vista");

    expect(calls.from).toBe("lot_origin_plots");
    expect(calls.eqArgs).toContainEqual(["plot_id", "p-baru-vista"]);

    expect(status).toEqual({
      plotId: "p-baru-vista",
      plotName: "Barú Vista",
      establishedYear: 2014,
      centroid: [-82.55, 8.81],
      geolocated: true,
      deforestationFree: true,
      declBasis: "2014 satellite baseline + owner declaration",
      feedsLots: ["JC-701", "JC-711"],
    });
  });

  it("returns null when the plot feeds no green lot (no fabricated compliance)", async () => {
    const { client } = makeClient({ data: [], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotOriginStatus } = await import("@/lib/db/eudr");
    expect(await getPlotOriginStatus("p-orphan")).toBeNull();
  });

  it("surfaces an ungeolocated / undeclared plot honestly", async () => {
    const bare: OriginPlotRow = {
      ...rowFor("JC-701"),
      centroid: null,
      geolocated: false,
      deforestation_free: false,
      decl_basis: null,
    };
    const { client } = makeClient({ data: [bare], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotOriginStatus } = await import("@/lib/db/eudr");
    const status = await getPlotOriginStatus("p-baru-vista");

    expect(status).toMatchObject({
      centroid: null,
      geolocated: false,
      deforestationFree: false,
      declBasis: null,
      feedsLots: ["JC-701"],
    });
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotOriginStatus } = await import("@/lib/db/eudr");
    await expect(getPlotOriginStatus("p-1")).rejects.toThrow(
      "getPlotOriginStatus: boom",
    );
  });
});
