import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapPlotFeature,
  mapReserveFeature,
  type PlotGeoRow,
  type ReserveGeoRow,
} from "@/lib/db/geo";

/**
 * geo.ts is the FeatureCollection seam for the map island. It mirrors the
 * plots.ts Row/map/cache()/getSupabase pattern: a *GeoRow interface, a pure
 * map*Feature mapper, and cache()'d getters returning GeoJSON FeatureCollections.
 *
 * Mappers are pinned on fixtures; getters are pinned by mocking @/lib/supabase.
 */

// ---- mapper tests (pure) ----------------------------------------------------

describe("mapPlotFeature", () => {
  const row: PlotGeoRow = {
    id: "p-tizingal-alto",
    name: "Tizingal Alto",
    block: "Block A",
    variety: "Geisha",
    status: "healthy",
    altitude_masl: 1690,
    geom: {
      type: "Polygon",
      coordinates: [
        [
          [-82.64, 8.77],
          [-82.63, 8.77],
          [-82.63, 8.78],
          [-82.64, 8.78],
          [-82.64, 8.77],
        ],
      ],
    },
  };

  it("builds a GeoJSON Feature with the polygon geometry + camelCase props", () => {
    const f = mapPlotFeature(row);
    expect(f.type).toBe("Feature");
    expect(f.geometry).toEqual(row.geom);
    expect(f.properties).toEqual({
      id: "p-tizingal-alto",
      name: "Tizingal Alto",
      block: "Block A",
      variety: "Geisha",
      status: "healthy",
      altitudeMasl: 1690,
    });
  });
});

describe("mapReserveFeature", () => {
  it("builds a Feature carrying id/name/kind", () => {
    const row: ReserveGeoRow = {
      id: "rz-quetzal",
      name: "Quetzal Cloud-Forest Reserve",
      kind: "reserve",
      area_ha: "200.9",
      geom: {
        type: "Polygon",
        coordinates: [
          [
            [-82.68, 8.82],
            [-82.66, 8.82],
            [-82.66, 8.84],
            [-82.68, 8.84],
            [-82.68, 8.82],
          ],
        ],
      },
    };
    const f = mapReserveFeature(row);
    expect(f.type).toBe("Feature");
    expect(f.geometry.type).toBe("Polygon");
    expect(f.properties).toEqual({
      id: "rz-quetzal",
      name: "Quetzal Cloud-Forest Reserve",
      kind: "reserve",
      areaHa: 200.9,
    });
  });
});

// ---- getter tests (mock @/lib/supabase/server) ------------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    not: vi.fn(() => builder),
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

function stubQuery<T>(data: T, error: { message: string } | null = null) {
  const builder = makeBuilder({ data, error });
  getSupabaseMock.mockReturnValue({ from: () => builder });
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});
afterEach(() => {
  vi.resetModules();
});

describe("getPlotsGeoJSON", () => {
  it("returns a FeatureCollection of plot polygons", async () => {
    stubQuery([
      {
        id: "p-tizingal-alto",
        name: "Tizingal Alto",
        block: "Block A",
        variety: "Geisha",
        status: "healthy",
        altitude_masl: 1690,
        geom: {
          type: "Polygon",
          coordinates: [
            [
              [-82.64, 8.77],
              [-82.63, 8.77],
              [-82.63, 8.78],
              [-82.64, 8.78],
              [-82.64, 8.77],
            ],
          ],
        },
      },
    ]);

    const { getPlotsGeoJSON } = await import("@/lib/db/geo");
    const fc = await getPlotsGeoJSON();

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.name).toBe("Tizingal Alto");
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("throws a labelled error when the query fails", async () => {
    stubQuery(null, { message: "boom" });
    const { getPlotsGeoJSON } = await import("@/lib/db/geo");
    await expect(getPlotsGeoJSON()).rejects.toThrow("getPlotsGeoJSON: boom");
  });
});

describe("getReserveGeoJSON", () => {
  it("returns a FeatureCollection of reserve polygons", async () => {
    stubQuery([
      {
        id: "rz-quetzal",
        name: "Quetzal Cloud-Forest Reserve",
        kind: "reserve",
        area_ha: "200.9",
        geom: {
          type: "Polygon",
          coordinates: [
            [
              [-82.68, 8.82],
              [-82.66, 8.82],
              [-82.66, 8.84],
              [-82.68, 8.84],
              [-82.68, 8.82],
            ],
          ],
        },
      },
    ]);

    const { getReserveGeoJSON } = await import("@/lib/db/geo");
    const fc = await getReserveGeoJSON();

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.kind).toBe("reserve");
  });
});
