import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OriginPlotRow } from "@/lib/db/eudr";

/**
 * Coverage of the `eudr.ts` READ-port (S8 — EUDR due-diligence traceability):
 * the pure `mapOriginPlot` mapper (GeoJSON Point → [lng, lat] flatten, null when
 * ungeolocated) and the getters' rpc/fetch + map round-trip. The trace + verdict
 * arithmetic is the view/RPC's job (pinned by the migration's PGlite tests, not
 * re-implemented here); this port only proves the row→domain seam + the verdict
 * (incl. the 'no-origin' fallback) survive the RPC/`cache()` round-trip.
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
    rpcName: undefined as string | undefined,
    rpcArgs: undefined as Record<string, unknown> | undefined,
  };
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    order: vi.fn((col: string, opts?: Record<string, unknown>) => {
      calls.orderArgs.push([col, opts]);
      return Promise.resolve(result);
    }),
  };
  const client = {
    from: (table: string) => {
      calls.from = table;
      return builder;
    },
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      calls.rpcName = name;
      calls.rpcArgs = args;
      return Promise.resolve(result);
    }),
  };
  return { client, calls };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("@/lib/db/greenlots", () => ({
  getGreenLotAtp: vi.fn(async () => [
    { greenLotCode: "JC-701", currentKg: 600 },
    { greenLotCode: "JC-711", currentKg: 880 },
  ]),
}));

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

const geoRow: OriginPlotRow = {
  green_lot_code: "JC-701",
  plot_id: "p-baru-vista",
  plot_name: "Barú Vista",
  established_year: 2015,
  centroid: { type: "Point", coordinates: [-82.633982, 8.777835] },
  geolocated: true,
  deforestation_free: true,
  decl_basis: "established-pre-cutoff",
};

const ungeoRow: OriginPlotRow = {
  green_lot_code: "JC-701",
  plot_id: "p-mystery",
  plot_name: "Mystery",
  established_year: 2019,
  centroid: null,
  geolocated: false,
  deforestation_free: false,
  decl_basis: null,
};

describe("mapOriginPlot", () => {
  it("flattens the GeoJSON Point to a [lng, lat] tuple and carries the EUDR facts", async () => {
    const { mapOriginPlot } = await import("@/lib/db/eudr");
    expect(mapOriginPlot(geoRow)).toEqual({
      plotId: "p-baru-vista",
      plotName: "Barú Vista",
      establishedYear: 2015,
      centroid: [-82.633982, 8.777835],
      geolocated: true,
      deforestationFree: true,
      declBasis: "established-pre-cutoff",
    });
  });

  it("maps a null centroid to a null tuple (ungeolocated plot)", async () => {
    const { mapOriginPlot } = await import("@/lib/db/eudr");
    const m = mapOriginPlot(ungeoRow);
    expect(m.centroid).toBeNull();
    expect(m.geolocated).toBe(false);
    expect(m.declBasis).toBeNull();
  });
});

describe("getLotEudrStatus", () => {
  it("calls eudr_lot_status with the lot code and returns the verdict", async () => {
    const { client, calls } = makeClient<string>({ data: "compliant", error: null });
    getSupabaseMock.mockReturnValue(client);
    const { getLotEudrStatus } = await import("@/lib/db/eudr");
    expect(await getLotEudrStatus("JC-701")).toBe("compliant");
    expect(calls.rpcName).toBe("eudr_lot_status");
    expect(calls.rpcArgs).toEqual({ p_lot_code: "JC-701" });
  });

  it("falls back to 'no-origin' on a null verdict (never a silent pass)", async () => {
    const { client } = makeClient<null>({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);
    const { getLotEudrStatus } = await import("@/lib/db/eudr");
    expect(await getLotEudrStatus("JC-999")).toBe("no-origin");
  });

  it("throws a labelled error when the RPC fails", async () => {
    const { client } = makeClient<null>({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);
    const { getLotEudrStatus } = await import("@/lib/db/eudr");
    await expect(getLotEudrStatus("JC-701")).rejects.toThrow(
      "getLotEudrStatus: boom",
    );
  });
});

describe("getLotOriginPlots", () => {
  it("reads lot_origin_plots scoped + ordered, mapped to domain rows", async () => {
    const { client, calls } = makeClient<OriginPlotRow[]>({
      data: [geoRow, ungeoRow],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotOriginPlots } = await import("@/lib/db/eudr");
    const plots = await getLotOriginPlots("JC-701");

    expect(calls.from).toBe("lot_origin_plots");
    expect(calls.eqArgs).toEqual([["green_lot_code", "JC-701"]]);
    expect(calls.orderArgs[0][0]).toBe("plot_id");
    expect(plots).toHaveLength(2);
    expect(plots[0].centroid).toEqual([-82.633982, 8.777835]);
  });
});

describe("getLotEudrDossier", () => {
  it("composes the verdict + origin plots into a dossier", async () => {
    // status RPC and origin-plots query both resolve from the same mock result;
    // give a verdict string and let the from() path return rows.
    const { client } = makeClient<unknown>({ data: "incomplete", error: null });
    // override: rpc returns the verdict, from-chain returns rows
    client.rpc = vi.fn(async () => ({ data: "incomplete", error: null })) as never;
    const fromBuilder = {
      select: () => fromBuilder,
      eq: () => fromBuilder,
      order: async () => ({ data: [geoRow], error: null }),
    };
    client.from = (() => fromBuilder) as never;
    getSupabaseMock.mockReturnValue(client);

    const { getLotEudrDossier } = await import("@/lib/db/eudr");
    const dossier = await getLotEudrDossier("JC-701");
    expect(dossier.code).toBe("JC-701");
    expect(dossier.status).toBe("incomplete");
    expect(dossier.originPlots).toHaveLength(1);
    expect(dossier.originPlots[0].plotId).toBe("p-baru-vista");
  });
});

describe("getEudrOriginPlotIds", () => {
  it("returns {plotId, plotName} tuples derived from getLotOriginPlots — no new DB round-trip", async () => {
    const { client } = makeClient<OriginPlotRow[]>({
      data: [geoRow, ungeoRow],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getEudrOriginPlotIds } = await import("@/lib/db/eudr");
    const refs = await getEudrOriginPlotIds("JC-701");

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ plotId: "p-baru-vista", plotName: "Barú Vista" });
    expect(refs[1]).toEqual({ plotId: "p-mystery", plotName: "Mystery" });
  });

  it("returns an empty array when no origin plots exist for the lot", async () => {
    const { client } = makeClient<OriginPlotRow[]>({ data: [], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getEudrOriginPlotIds } = await import("@/lib/db/eudr");
    expect(await getEudrOriginPlotIds("JC-000")).toEqual([]);
  });
});
