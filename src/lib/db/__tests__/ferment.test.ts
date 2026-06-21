import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FermentBatchRow,
  FermentCurveRow,
  FermentCutpointRow,
  FermentRecipeRow,
  WaterPerKgRow,
} from "@/lib/db/ferment";

/**
 * Coverage of the `ferment.ts` READ-port (P2-S3 — the make-quality slice): the pure
 * mappers (snake_case row → camelCase domain, numeric coercion of pH/temp/Brix/liters
 * columns PostgREST may serialize as strings) and the `cache()`-wrapped getters'
 * fetch + map round-trip. Mirrors the greenlots.test.ts idiom: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder keyed per table/view. The cut-point arithmetic itself is the SQL
 * view's job (pinned by the migration's PGlite tests); this port only proves the
 * row→domain seam survives `cache()`.
 */

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
        in: vi.fn(() => builder),
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
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

function stubTables(results: TableResults) {
  getSupabaseMock.mockReturnValue(makeClient(results));
}

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

// ----- sample rows ----------------------------------------------------------

const recipeRow: FermentRecipeRow = {
  id: "rec-geisha-anaerobic-v1",
  name: "Volcán Geisha Anaerobic",
  method: "Anaerobic",
  altitude_band: "1500-1700",
  target_ph: "4.2",
  target_temp_c: "20",
  target_brix_drop: "4",
  target_hours: "36",
  version: 1,
  superseded_by: null,
};

const batchRow: FermentBatchRow = {
  id: "00000000-0000-0000-0000-0000000000b1",
  lot_code: "JC-800",
  recipe_id: "rec-geisha-anaerobic-v1",
  method: "Anaerobic",
  started_at: "2026-06-20T06:00:00Z",
  ended_at: null,
};

const curveRow: FermentCurveRow = {
  batch_id: "00000000-0000-0000-0000-0000000000b1",
  lot_code: "JC-800",
  reading_kind: "ph",
  value: "5.4",
  occurred_at: "2026-06-20T08:00:00Z",
  hours_elapsed: "2",
};

const cutpointRow: FermentCutpointRow = {
  batch_id: "00000000-0000-0000-0000-0000000000b1",
  lot_code: "JC-800",
  recipe_id: "rec-geisha-anaerobic-v1",
  target_ph: "4.2",
  target_hours: "36",
  latest_ph: "4.1",
  latest_at: "2026-06-20T12:00:00Z",
  hours_elapsed: "6",
  cut_reached: true,
};

const waterRow: WaterPerKgRow = {
  lot_code: "JC-800",
  lot_kg: "120",
  total_liters: "360",
  liters_per_kg: "3",
};

// ----- pure mappers ---------------------------------------------------------

describe("mapFermentRecipe", () => {
  it("coerces the numeric curve fields and passes the supersede pointer through", async () => {
    const { mapFermentRecipe } = await import("@/lib/db/ferment");
    expect(mapFermentRecipe(recipeRow)).toEqual({
      id: "rec-geisha-anaerobic-v1",
      name: "Volcán Geisha Anaerobic",
      method: "Anaerobic",
      altitudeBand: "1500-1700",
      targetPh: 4.2,
      targetTempC: 20,
      targetBrixDrop: 4,
      targetHours: 36,
      version: 1,
      supersededBy: null,
    });
  });
});

describe("mapFermentCurvePoint", () => {
  it("coerces value + hours_elapsed to numbers", async () => {
    const { mapFermentCurvePoint } = await import("@/lib/db/ferment");
    expect(mapFermentCurvePoint(curveRow)).toEqual({
      batchId: "00000000-0000-0000-0000-0000000000b1",
      lotCode: "JC-800",
      readingKind: "ph",
      value: 5.4,
      occurredAt: "2026-06-20T08:00:00Z",
      hoursElapsed: 2,
    });
  });
});

describe("mapFermentCutpoint", () => {
  it("coerces the numeric fields and preserves the cut_reached boolean", async () => {
    const { mapFermentCutpoint } = await import("@/lib/db/ferment");
    expect(mapFermentCutpoint(cutpointRow)).toEqual({
      batchId: "00000000-0000-0000-0000-0000000000b1",
      lotCode: "JC-800",
      recipeId: "rec-geisha-anaerobic-v1",
      targetPh: 4.2,
      targetHours: 36,
      latestPh: 4.1,
      latestAt: "2026-06-20T12:00:00Z",
      hoursElapsed: 6,
      cutReached: true,
    });
  });

  it("coerces null latest readings to null (a batch with no pH readings yet)", async () => {
    const { mapFermentCutpoint } = await import("@/lib/db/ferment");
    const m = mapFermentCutpoint({
      ...cutpointRow,
      latest_ph: null,
      latest_at: null,
      hours_elapsed: null,
      cut_reached: false,
    });
    expect(m.latestPh).toBeNull();
    expect(m.latestAt).toBeNull();
    expect(m.hoursElapsed).toBeNull();
    expect(m.cutReached).toBe(false);
  });
});

describe("mapWaterPerKg", () => {
  it("coerces the liters/per-kg numerics; null per-kg (zero-mass lot) stays null", async () => {
    const { mapWaterPerKg } = await import("@/lib/db/ferment");
    expect(mapWaterPerKg(waterRow)).toEqual({
      lotCode: "JC-800",
      lotKg: 120,
      totalLiters: 360,
      litersPerKg: 3,
    });
    const zero = mapWaterPerKg({ ...waterRow, lot_kg: "0", liters_per_kg: null });
    expect(zero.litersPerKg).toBeNull();
  });
});

// ----- getters --------------------------------------------------------------

describe("getActiveRecipes", () => {
  it("reads ferment_recipes and returns camelCase recipes", async () => {
    stubTables({ ferment_recipes: { data: [recipeRow], error: null } });
    const { getActiveRecipes } = await import("@/lib/db/ferment");
    const recipes = await getActiveRecipes();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].id).toBe("rec-geisha-anaerobic-v1");
    expect(recipes[0].targetPh).toBe(4.2);
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ ferment_recipes: { data: null, error: { message: "boom" } } });
    const { getActiveRecipes } = await import("@/lib/db/ferment");
    await expect(getActiveRecipes()).rejects.toThrow("getActiveRecipes: boom");
  });
});

describe("getFermentBatches", () => {
  it("reads ferment_batches and returns camelCase batches", async () => {
    stubTables({ ferment_batches: { data: [batchRow], error: null } });
    const { getFermentBatches } = await import("@/lib/db/ferment");
    const batches = await getFermentBatches();
    expect(batches[0].lotCode).toBe("JC-800");
    expect(batches[0].endedAt).toBeNull();
  });
});

describe("getFermentCurve", () => {
  it("reads v_ferment_curve for one batch and returns camelCase points", async () => {
    stubTables({ v_ferment_curve: { data: [curveRow], error: null } });
    const { getFermentCurve } = await import("@/lib/db/ferment");
    const points = await getFermentCurve("00000000-0000-0000-0000-0000000000b1");
    expect(points[0].readingKind).toBe("ph");
    expect(points[0].value).toBe(5.4);
  });
});

describe("getFermentCutpoint", () => {
  it("reads v_ferment_cutpoint for one batch and returns the cut projection", async () => {
    stubTables({ v_ferment_cutpoint: { data: [cutpointRow], error: null } });
    const { getFermentCutpoint } = await import("@/lib/db/ferment");
    const cut = await getFermentCutpoint("00000000-0000-0000-0000-0000000000b1");
    expect(cut?.cutReached).toBe(true);
    expect(cut?.targetPh).toBe(4.2);
  });

  it("returns null when the batch has no cutpoint row", async () => {
    stubTables({ v_ferment_cutpoint: { data: [], error: null } });
    const { getFermentCutpoint } = await import("@/lib/db/ferment");
    const cut = await getFermentCutpoint("missing");
    expect(cut).toBeNull();
  });
});

describe("getWaterPerKg", () => {
  it("reads v_water_per_kg for one lot and returns the sustainability number", async () => {
    stubTables({ v_water_per_kg: { data: [waterRow], error: null } });
    const { getWaterPerKg } = await import("@/lib/db/ferment");
    const water = await getWaterPerKg("JC-800");
    expect(water?.litersPerKg).toBe(3);
  });

  it("returns null when the lot has no water log", async () => {
    stubTables({ v_water_per_kg: { data: [], error: null } });
    const { getWaterPerKg } = await import("@/lib/db/ferment");
    expect(await getWaterPerKg("JC-800")).toBeNull();
  });
});
